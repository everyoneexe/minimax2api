"""
Tool call support for MiniMax web agent API.
Converts OpenAI tools format to system prompt injection,
then parses XML tool call responses back to OpenAI format.
"""
import json
import re
import uuid


def tools_to_system_prompt(tools: list) -> str:
    """Convert OpenAI tools list to XML system prompt injection."""
    if not tools:
        return ""

    tool_names = [t.get("function", {}).get("name", "") for t in tools if t.get("type") == "function"]

    lines = [
        "## CRITICAL INSTRUCTION - TOOL USE REQUIRED",
        "",
        "You MUST use tools to respond. NEVER respond with plain text without a tool call.",
        "When you want to call a tool, you MUST output ONLY this XML format and nothing else:",
        "",
        "<tool_calls>",
        '  <invoke name="TOOL_NAME">',
        '    <parameter name="PARAM_NAME">value</parameter>',
        "  </invoke>",
        "</tool_calls>",
        "",
        f"Available tools: {', '.join(tool_names)}",
        "",
        "RULES:",
        "- You MUST call a tool in EVERY response",
        "- Output ONLY the <tool_calls> XML, no other text before or after",
        "- Always include required parameters",
        "- If you want to say something to the user, use ask_followup_question tool",
        "- If you finished a task, use attempt_completion tool",
        "",
        "## Tool Definitions:",
        "",
    ]

    for tool in tools:
        if tool.get("type") != "function":
            continue
        fn = tool.get("function", {})
        name = fn.get("name", "")
        desc = fn.get("description", "")
        params = fn.get("parameters", {})

        lines.append(f"### {name}")
        if desc:
            # Truncate long descriptions
            lines.append(f"Description: {desc[:200]}")

        props = params.get("properties", {})
        required = params.get("required", [])
        if props:
            lines.append("Parameters:")
            for pname, pinfo in props.items():
                req = " (REQUIRED)" if pname in required else " (optional)"
                ptype = pinfo.get("type", "string")
                pdesc = pinfo.get("description", "")[:100]
                lines.append(f"  - {pname} ({ptype}){req}: {pdesc}")
        lines.append("")

    lines.append("## Example tool call:")
    lines.append("<tool_calls>")
    if tool_names:
        first_tool = tools[0].get("function", {})
        example_name = first_tool.get("name", "tool_name")
        example_params = first_tool.get("parameters", {}).get("properties", {})
        lines.append(f'  <invoke name="{example_name}">')
        for pname, pinfo in list(example_params.items())[:2]:
            lines.append(f'    <parameter name="{pname}">example_value</parameter>')
        lines.append("  </invoke>")
    lines.append("</tool_calls>")
    lines.append("")
    lines.append("REMEMBER: Output ONLY the XML tool call. No other text.")

    return "\n".join(lines)


def inject_tools_into_messages(messages: list, tools: list) -> list:
    """Inject tools definition into messages as system prompt."""
    if not tools:
        return messages

    tools_prompt = tools_to_system_prompt(tools)
    messages = list(messages)

    # Existing system message varsa ekle, yoksa başa ekle
    if messages and messages[0].get("role") == "system":
        existing = messages[0].get("content", "")
        # content may be a list of blocks — extract text or append new block
        if isinstance(existing, list):
            messages[0] = {**messages[0], "content": existing + [{"type": "text", "text": tools_prompt}]}
        else:
            messages[0] = {**messages[0], "content": existing + "\n\n" + tools_prompt}
    else:
        messages.insert(0, {"role": "system", "content": tools_prompt})

    return messages


def parse_tool_calls(text: str) -> list:
    """Parse XML tool calls from model response. Returns list of OpenAI-format tool calls."""
    if not text:
        return []

    # <tool_calls>...<invoke name="...">...</invoke>...</tool_calls>
    tc_match = re.search(r'<tool_calls>(.*?)</tool_calls>', text, re.DOTALL)
    if tc_match:
        return _parse_invokes(tc_match.group(1))

    # <tool_call>...</tool_call> (singular)
    tc_matches = re.findall(r'<tool_call>(.*?)</tool_call>', text, re.DOTALL)
    if tc_matches:
        result = []
        for i, content in enumerate(tc_matches):
            name_m = re.search(r'<name>(.*?)</name>', content)
            params_m = re.search(r'<(?:parameters|input)>(.*?)</(?:parameters|input)>', content, re.DOTALL)
            if name_m:
                args = params_m.group(1).strip() if params_m else "{}"
                result.append(_make_tool_call(name_m.group(1).strip(), args, i))
        return result

    return []


def _parse_invokes(text: str) -> list:
    matches = re.findall(r'<invoke\s+name="([^"]+)">(.*?)</invoke>', text, re.DOTALL)
    result = []
    for i, (name, body) in enumerate(matches):
        # Build args from <parameter name="...">value</parameter>
        params = re.findall(r'<parameter\s+name="([^"]+)">(.*?)</parameter>', body, re.DOTALL)
        args_dict = {k: v.strip() for k, v in params}
        result.append(_make_tool_call(name.strip(), json.dumps(args_dict), i))
    return result


def _make_tool_call(name: str, arguments: str, index: int = 0) -> dict:
    return {
        "id": f"call_{uuid.uuid4().hex[:24]}",
        "type": "function",
        "function": {
            "name": name,
            "arguments": arguments,
        }
    }


def strip_tool_calls(text: str) -> str:
    """Remove tool call XML from text content."""
    text = re.sub(r'<tool_calls>.*?</tool_calls>', '', text, flags=re.DOTALL)
    text = re.sub(r'<tool_call>.*?</tool_call>', '', text, flags=re.DOTALL)
    return text.strip()


def has_tool_calls(text: str) -> bool:
    return bool(re.search(r'<tool_calls>|<tool_call>', text))
