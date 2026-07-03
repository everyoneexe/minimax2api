"""
Tool call support for MiniMax web agent API.
Converts OpenAI tools format to system prompt injection,
then parses JSON tool call responses back to OpenAI format.
"""
import json
import re
import uuid


def tools_to_system_prompt(tools: list) -> str:
    """Inject minimal tool list so model knows what tools are available."""
    if not tools:
        return ""

    lines = ["You have access to these tools (use native tool calling):"]
    for tool in tools:
        if tool.get("type") != "function":
            continue
        fn = tool.get("function", {})
        name = fn.get("name", "")
        desc = fn.get("description", "")[:120]
        lines.append(f"- {name}: {desc}")

    return "\n".join(lines)


def inject_tools_into_messages(messages: list, tools: list) -> list:
    """Inject tools definition into messages as system prompt."""
    if not tools:
        return messages

    tools_prompt = tools_to_system_prompt(tools)
    messages = list(messages)

    if messages and messages[0].get("role") == "system":
        existing = messages[0].get("content", "")
        if isinstance(existing, list):
            messages[0] = {**messages[0], "content": existing + [{"type": "text", "text": tools_prompt}]}
        else:
            messages[0] = {**messages[0], "content": existing + "\n\n" + tools_prompt}
    else:
        messages.insert(0, {"role": "system", "content": tools_prompt})

    return messages


def parse_tool_calls(text: str) -> list:
    """Parse JSON tool calls from model response."""
    if not text:
        return []

    # JSON format: ```json\n{"tool": "...", "parameters": {...}}\n```
    json_matches = re.findall(r'```(?:json)?\s*(\{[^`]+\})\s*```', text, re.DOTALL)
    for match in json_matches:
        try:
            data = json.loads(match.strip())
            if "tool" in data:
                return [_make_tool_call(data["tool"], json.dumps(data.get("parameters", {})))]
        except (json.JSONDecodeError, KeyError):
            continue

    # Bare JSON: {"tool": "...", "parameters": {...}}
    json_matches2 = re.findall(r'\{[^{}]*"tool"\s*:[^{}]*\}', text, re.DOTALL)
    for match in json_matches2:
        try:
            data = json.loads(match.strip())
            if "tool" in data:
                return [_make_tool_call(data["tool"], json.dumps(data.get("parameters", {})))]
        except (json.JSONDecodeError, KeyError):
            continue

    # Legacy XML format fallback
    tc_match = re.search(r'<tool_calls>(.*?)</tool_calls>', text, re.DOTALL)
    if tc_match:
        return _parse_invokes(tc_match.group(1))

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
    """Remove tool call JSON/XML from text content."""
    text = re.sub(r'```(?:json)?\s*\{[^`]*"tool"[^`]*\}\s*```', '', text, flags=re.DOTALL)
    text = re.sub(r'<tool_calls>.*?</tool_calls>', '', text, flags=re.DOTALL)
    text = re.sub(r'<tool_call>.*?</tool_call>', '', text, flags=re.DOTALL)
    return text.strip()


def has_tool_calls(text: str) -> bool:
    if re.search(r'```(?:json)?\s*\{[^`]*"tool"\s*:', text, re.DOTALL):
        return True
    if re.search(r'\{[^{}]*"tool"\s*:', text):
        return True
    return bool(re.search(r'<tool_calls>|<tool_call>', text))
