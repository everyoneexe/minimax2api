"""
Tool call support for MiniMax web agent API.

Uses DSML (ds2api approach): inject tool definitions + XML format into system
prompt, parse <tool_calls>/<invoke> XML from response, convert to OpenAI format.
"""
import json
import re
import uuid
import xml.etree.ElementTree as ET


# ── System prompt injection ──────────────────────────────────────────────────

def tools_to_system_prompt(tools: list) -> str:
    """Build DSML-style tool injection prompt."""
    if not tools:
        return ""

    descriptions = ["You have access to these tools:\n"]
    tool_names = []

    for tool in tools:
        if tool.get("type") != "function":
            continue
        fn = tool.get("function", {})
        name = fn.get("name", "")
        desc = fn.get("description", "")
        params = fn.get("parameters", {})
        tool_names.append(name)

        descriptions.append(f"Tool: {name}")
        if desc:
            descriptions.append(f"Description: {desc}")
        props = params.get("properties", {})
        required = params.get("required", [])
        if props:
            descriptions.append("Parameters:")
            for pname, pinfo in props.items():
                req = " (required)" if pname in required else ""
                ptype = pinfo.get("type", "string")
                pdesc = pinfo.get("description", "")
                descriptions.append(f"  - {pname} ({ptype}){req}: {pdesc}")
        descriptions.append("")

    instructions = _build_instructions(tool_names)
    return "\n".join(descriptions) + "\n" + instructions


def _build_instructions(tool_names: list) -> str:
    names_str = ", ".join(tool_names)
    return f"""TOOL CALL FORMAT — FOLLOW EXACTLY:

When you need to call a tool, output this XML at the END of your response:

<tool_calls>
  <invoke name="TOOL_NAME_HERE">
    <parameter name="PARAM_NAME"><![CDATA[PARAM_VALUE]]></parameter>
  </invoke>
</tool_calls>

Rules:
- Available tools: {names_str}
- String values MUST use <![CDATA[...]]>
- Numbers, booleans use plain text (no CDATA)
- Place <tool_calls> block at the very END of your response
- Do NOT wrap in markdown code fences
- If no tool needed, respond normally without <tool_calls>
"""


def inject_tools_into_messages(messages: list, tools: list) -> list:
    """Inject tool definitions into system prompt."""
    if not tools:
        return messages

    tools_prompt = tools_to_system_prompt(tools)
    if not tools_prompt:
        return messages

    messages = list(messages)
    if messages and messages[0].get("role") == "system":
        existing = messages[0].get("content", "")
        if isinstance(existing, str):
            messages[0] = {**messages[0], "content": existing + "\n\n" + tools_prompt}
        elif isinstance(existing, list):
            messages[0] = {**messages[0], "content": existing + [{"type": "text", "text": tools_prompt}]}
    else:
        messages.insert(0, {"role": "system", "content": tools_prompt})
    return messages


# ── Response parsing ─────────────────────────────────────────────────────────

def parse_tool_calls(text: str) -> list:
    """Parse <tool_calls><invoke> XML from model response."""
    if not text:
        return []

    # Normalize DSML prefixed tags → plain tags
    text_norm = _normalize_dsml(text)

    # Strip markdown fences that might wrap the XML
    text_norm = re.sub(r'```(?:xml)?\s*', '', text_norm)
    text_norm = re.sub(r'\s*```', '', text_norm)

    result = _parse_xml_tool_calls(text_norm)
    if result:
        return result

    # Fallback: bare JSON {"name":"...","arguments":{...}}
    for match in re.findall(r'\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^{}]*\}[^{}]*\}', text_norm, re.DOTALL):
        try:
            data = json.loads(match.strip())
            if "name" in data and "arguments" in data:
                return [_make_tool_call(data["name"], json.dumps(data["arguments"]))]
        except (json.JSONDecodeError, KeyError):
            continue

    return []


def _normalize_dsml(text: str) -> str:
    """Convert <|DSML|tag> → <tag> for parsing."""
    text = re.sub(r'<\|DSML\|(/?)(\w+)', r'<\1\2', text)
    return text


def _parse_xml_tool_calls(text: str) -> list:
    """Find and parse <tool_calls>...<invoke>...</invoke></tool_calls> blocks."""
    result = []

    # Find all tool_calls blocks
    blocks = re.findall(r'<tool_calls>(.*?)</tool_calls>', text, re.DOTALL)
    for block in blocks:
        invokes = re.findall(r'<invoke\s+name=["\']([^"\']+)["\']>(.*?)</invoke>', block, re.DOTALL)
        for name, body in invokes:
            args = _parse_parameters(body)
            result.append(_make_tool_call(name.strip(), json.dumps(args)))

    return result


def _parse_parameters(body: str) -> dict:
    """Parse <parameter name="...">value</parameter> from invoke body."""
    args = {}
    params = re.findall(
        r'<parameter\s+name=["\']([^"\']+)["\']>(.*?)</parameter>',
        body, re.DOTALL
    )
    for pname, pvalue in params:
        pvalue = pvalue.strip()
        # Extract CDATA content
        cdata = re.search(r'<!\[CDATA\[(.*?)\]\]>', pvalue, re.DOTALL)
        if cdata:
            pvalue = cdata.group(1)
        else:
            # Try JSON parse for numbers/booleans/objects
            try:
                pvalue = json.loads(pvalue)
            except (json.JSONDecodeError, ValueError):
                pass
        args[pname] = pvalue
    return args


def _make_tool_call(name: str, arguments: str, index: int = 0) -> dict:
    return {
        "id": f"call_{uuid.uuid4().hex[:24]}",
        "type": "function",
        "function": {
            "name": name,
            "arguments": arguments,
        }
    }


# ── Utilities ────────────────────────────────────────────────────────────────

def strip_tool_calls(text: str) -> str:
    """Remove tool call XML/JSON from text content."""
    text = re.sub(r'<tool_calls>.*?</tool_calls>', '', text, flags=re.DOTALL)
    text = re.sub(r'<\|DSML\|tool_calls>.*?</\|DSML\|tool_calls>', '', text, flags=re.DOTALL)
    text = re.sub(r'\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^{}]*\}[^{}]*\}', '', text, flags=re.DOTALL)
    return text.strip()


def has_tool_calls(text: str) -> bool:
    if re.search(r'<tool_calls>|<\|DSML\|tool_calls>', text):
        return True
    if re.search(r'\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:', text):
        return True
    return False
