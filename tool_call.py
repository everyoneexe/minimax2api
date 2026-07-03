"""
Tool call support for MiniMax web agent API.
Converts OpenAI tools format to system prompt injection,
then parses JSON tool call responses back to OpenAI format.
"""
import json
import re
import uuid


def tools_to_system_prompt(tools: list) -> str:
    """No injection needed — native tool_call works."""
    return ""


def inject_tools_into_messages(messages: list, tools: list) -> list:
    """No injection needed — tools passed natively via OpenAI tools array."""
    return messages


def parse_tool_calls(text: str) -> list:
    """Parse tool calls from model response — JSON format: {"name":"...","arguments":{...}}"""
    if not text:
        return []

    # New format: {"name":"tool_name","arguments":{...}}
    for match in re.findall(r'\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^{}]*\}[^{}]*\}', text, re.DOTALL):
        try:
            data = json.loads(match.strip())
            if "name" in data and "arguments" in data:
                return [_make_tool_call(data["name"], json.dumps(data["arguments"]))]
        except (json.JSONDecodeError, KeyError):
            continue

    # Legacy JSON: {"tool": "...", "parameters": {...}}
    for match in re.findall(r'```(?:json)?\s*(\{[^`]+\})\s*```', text, re.DOTALL):
        try:
            data = json.loads(match.strip())
            if "tool" in data:
                return [_make_tool_call(data["tool"], json.dumps(data.get("parameters", {})))]
        except (json.JSONDecodeError, KeyError):
            continue

    # Legacy XML fallback
    tc_match = re.search(r'<tool_calls>(.*?)</tool_calls>', text, re.DOTALL)
    if tc_match:
        return _parse_invokes(tc_match.group(1))

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
    """Remove tool call JSON from text content."""
    text = re.sub(r'\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^{}]*\}[^{}]*\}', '', text, flags=re.DOTALL)
    text = re.sub(r'```(?:json)?\s*\{[^`]*"tool"[^`]*\}\s*```', '', text, flags=re.DOTALL)
    text = re.sub(r'<tool_calls>.*?</tool_calls>', '', text, flags=re.DOTALL)
    return text.strip()


def has_tool_calls(text: str) -> bool:
    if re.search(r'\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:', text):
        return True
    if re.search(r'```(?:json)?\s*\{[^`]*"tool"\s*:', text, re.DOTALL):
        return True
    return bool(re.search(r'<tool_calls>', text))
