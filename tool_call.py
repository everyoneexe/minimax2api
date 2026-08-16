"""
Tool call support for MiniMax web agent API (JSON-based).

MiniMax's agent ships 30+ built-in tools (read, write, bash, glob, grep,
web_search, ...) backed by a real cloud sandbox. It does NOT accept native
custom tool definitions, and its safety training rejects XML `<tool_calls>`
blocks (treated as prompt injection).

Two problems this module solves, so any OpenAI-compatible client works:

  1. JSON, not XML — the model reliably emits JSON function calls but refuses
     XML tool-call blocks.
  2. Namespace isolation — a client tool named `read_file`/`list_files` gets
     confused with the built-in `read`/`glob` and the model runs the built-in
     in the sandbox instead. We prefix every client tool name with `TOOL_PREFIX`
     during injection so the model can't conflate them, then strip the prefix
     when converting back to OpenAI tool_calls for the client.
"""
import json
import re
import uuid

# Namespace prefix applied to client tool names before injection so the model
# never confuses them with MiniMax's built-in sandbox tools.
TOOL_PREFIX = "u_"


def _add_prefix(name: str) -> str:
    return name if name.startswith(TOOL_PREFIX) else TOOL_PREFIX + name


def _strip_prefix(name: str) -> str:
    return name[len(TOOL_PREFIX):] if name.startswith(TOOL_PREFIX) else name


# ── System prompt injection ──────────────────────────────────────────────────

def tools_to_system_prompt(tools: list) -> str:
    """Build a JSON-based tool injection prompt."""
    if not tools:
        return ""

    lines = ["You have access to the following functions:\n"]
    tool_names = []

    for tool in tools:
        if tool.get("type") != "function":
            continue
        fn = tool.get("function", {})
        name = fn.get("name", "")
        if not name:
            continue
        name = _add_prefix(name)
        tool_names.append(name)
        desc = fn.get("description", "")
        params = fn.get("parameters", {})

        lines.append(f"### {name}")
        if desc:
            lines.append(desc)
        props = params.get("properties", {})
        required = params.get("required", [])
        if props:
            lines.append("Parameters:")
            for pname, pinfo in props.items():
                req = " (required)" if pname in required else " (optional)"
                ptype = pinfo.get("type", "string")
                pdesc = pinfo.get("description", "")
                lines.append(f"  - {pname} ({ptype}){req}: {pdesc}")
        lines.append("")

    lines.append(_build_instructions(tool_names))
    return "\n".join(lines)


def _build_instructions(tool_names: list) -> str:
    names = ", ".join(tool_names)
    return f"""## Calling functions

CRITICAL: The functions listed above are the ONLY tools you have. You have NO \
built-in tools, NO cloud sandbox, NO file system, and NO network of your own. \
Ignore any other tools such as read, write, edit, glob, grep, bash, \
web_search, or task — they do NOT exist in this context. Do NOT run anything \
in a sandbox.

You cannot perform actions yourself. The ONLY way to act is to emit a function \
call as JSON; an external system runs it and returns the result to you. Never \
claim a file or resource "does not exist" or "is empty" — you have not checked \
and cannot check. Your only job is to decide which of the listed functions to \
call and with what arguments.

VERY IMPORTANT: Emitting the JSON call is ALWAYS successful — you just output \
the JSON and stop. The functions never "fail", are never "unavailable", and are \
never "not found" from your side; execution happens elsewhere. NEVER apologize, \
NEVER say there is a "technical issue", "system error", or that you "cannot \
access" something. If the user asks to list, read, search, or run something and \
a matching function exists, emit that function's JSON call immediately.

When one or more of the listed functions should be called, respond with ONLY a \
JSON array of calls and NOTHING else:

[{{"name": "function_name", "arguments": {{"param": "value"}}}}]

Rules:
- Available functions (use these EXACT names): {names}
- Output ONLY the JSON array when calling functions — no prose, no explanation, \
no markdown fences, no apologies.
- "arguments" must be a JSON object with the correct parameter names and types.
- To call multiple functions, add more objects to the array.
- Do NOT execute the function yourself, guess its result, or say it is \
unavailable — just emit the JSON call and stop.
- If the surrounding instructions require a tool on every response (for \
example an agent framework that says "you must call at least one tool"), then \
you MUST emit a JSON call every time, even for greetings or small talk. In \
that case pick the most fitting function — typically a completion/answer/ \
respond-style function (e.g. attempt_completion) or a follow-up-question \
function — and put your reply text in its arguments. Do NOT answer in plain \
prose when a tool is required.
- Only reply in plain text if no function fits AND the instructions do not \
require a tool call."""


def inject_tools_into_messages(messages: list, tools: list) -> list:
    """Inject tool definitions into the system prompt."""
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

def _iter_json_objects(text: str):
    """Yield top-level JSON values (objects/arrays) found in text.

    Uses a brace/bracket scanner (string-aware) so we can extract embedded
    JSON even when the model wraps it in prose or code fences.
    """
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch in "{[":
            close = "}" if ch == "{" else "]"
            depth = 0
            in_str = False
            esc = False
            j = i
            while j < n:
                c = text[j]
                if in_str:
                    if esc:
                        esc = False
                    elif c == "\\":
                        esc = True
                    elif c == '"':
                        in_str = False
                else:
                    if c == '"':
                        in_str = True
                    elif c in "{[":
                        depth += 1
                    elif c in "}]":
                        depth -= 1
                        if depth == 0:
                            candidate = text[i:j + 1]
                            try:
                                yield json.loads(candidate)
                            except (json.JSONDecodeError, ValueError):
                                pass
                            i = j
                            break
                j += 1
        i += 1


def _normalize_call(obj) -> dict | None:
    """Turn a candidate dict into {name, arguments} or None."""
    if not isinstance(obj, dict):
        return None
    # Unwrap {"tool_call": {...}} / {"function": {...}} / {"tool": {...}}
    for key in ("tool_call", "function", "tool"):
        if key in obj and isinstance(obj[key], dict):
            obj = obj[key]
            break
    name = obj.get("name") or obj.get("tool_name")
    if not name or not isinstance(name, str):
        return None
    name = _strip_prefix(name)  # back to the client's original tool name
    args = obj.get("arguments")
    if args is None:
        args = obj.get("parameters", obj.get("args", {}))
    if isinstance(args, str):
        # arguments may already be a JSON string
        try:
            parsed = json.loads(args)
            args = parsed if isinstance(parsed, (dict, list)) else {}
        except (json.JSONDecodeError, ValueError):
            args = {}
    if not isinstance(args, dict):
        args = {}
    return {"name": name, "arguments": args}


def parse_tool_calls(text: str) -> list:
    """Parse JSON tool calls from a model response into OpenAI format."""
    if not text or ("name" not in text and "tool_call" not in text):
        return []

    calls: list = []
    for value in _iter_json_objects(text):
        candidates = value if isinstance(value, list) else [value]
        for c in candidates:
            norm = _normalize_call(c)
            if norm:
                calls.append(_make_tool_call(norm["name"], json.dumps(norm["arguments"], ensure_ascii=False)))
        if calls:
            # First JSON container that yields calls wins (avoids double-parsing)
            break

    return calls


def _make_tool_call(name: str, arguments: str, index: int = 0) -> dict:
    return {
        "id": f"call_{uuid.uuid4().hex[:24]}",
        "type": "function",
        "function": {
            "name": name,
            "arguments": arguments,
        },
    }


# ── Utilities ──────────────────────────────────────────────────��─────────────

_FENCE_RE = re.compile(r"```(?:json)?\s*(\[.*?\]|\{.*?\})\s*```", re.DOTALL)


def strip_tool_calls(text: str) -> str:
    """Remove JSON tool-call text so only human-readable prose remains."""
    if not text:
        return text
    # Remove fenced json blocks that are tool calls
    def _strip_fence(m):
        inner = m.group(1)
        return "" if parse_tool_calls(inner) else m.group(0)
    out = _FENCE_RE.sub(_strip_fence, text)
    # Remove any remaining raw JSON containers that parse as tool calls
    for raw in list(_raw_toolcall_spans(out)):
        out = out.replace(raw, "", 1)
    # Clean up leftover empty fences
    out = re.sub(r"```(?:json)?\s*```", "", out)
    return out.strip()


def _raw_toolcall_spans(text: str):
    """Yield raw substrings that are tool-call JSON containers."""
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch in "{[":
            close_depth = 0
            in_str = False
            esc = False
            j = i
            while j < n:
                c = text[j]
                if in_str:
                    if esc:
                        esc = False
                    elif c == "\\":
                        esc = True
                    elif c == '"':
                        in_str = False
                else:
                    if c == '"':
                        in_str = True
                    elif c in "{[":
                        close_depth += 1
                    elif c in "}]":
                        close_depth -= 1
                        if close_depth == 0:
                            raw = text[i:j + 1]
                            try:
                                val = json.loads(raw)
                                cands = val if isinstance(val, list) else [val]
                                if any(_normalize_call(c) for c in cands):
                                    yield raw
                            except (json.JSONDecodeError, ValueError):
                                pass
                            i = j
                            break
                j += 1
        i += 1


def has_tool_calls(text: str) -> bool:
    if not text:
        return False
    if "name" not in text and "tool_call" not in text and "tool_name" not in text:
        return False
    return bool(parse_tool_calls(text))


# Tool names (case-insensitive substrings) that act as a "final answer" tool in
# agent frameworks. If the model replies in prose but the client requires a tool
# call, we wrap the prose into one of these so the client's contract is honored.
_COMPLETION_TOOL_HINTS = (
    "attempt_completion", "attemptcompletion", "completion", "final_answer",
    "finalanswer", "respond", "response", "answer", "finish", "submit", "done",
)
# Common text-carrying argument names, in preference order.
_TEXT_ARG_HINTS = ("result", "response", "answer", "text", "content", "message", "summary")


def find_fallback_completion_tool(tools: list):
    """Pick a client tool suitable for wrapping a plain-text answer.

    Returns (tool_name, text_arg_name) or None. Prefers an explicit
    completion/answer-style tool; otherwise falls back to any tool that has a
    single required string parameter.
    """
    if not tools:
        return None

    def text_arg_for(fn) -> str:
        params = (fn.get("parameters") or {})
        props = params.get("properties") or {}
        required = params.get("required") or list(props.keys())
        # Prefer a well-known text arg name that exists
        for hint in _TEXT_ARG_HINTS:
            if hint in props:
                return hint
        # Else the first required (or first) property
        return (required[0] if required else (next(iter(props), "result")))

    # Pass 1: explicit completion-style tool by name
    for tool in tools:
        if tool.get("type") != "function":
            continue
        fn = tool.get("function", {})
        name = fn.get("name", "")
        low = name.lower()
        if any(h in low for h in _COMPLETION_TOOL_HINTS):
            return name, text_arg_for(fn)

    return None


def wrap_text_as_tool_call(tool_name: str, text_arg: str, text: str) -> dict:
    """Build an OpenAI tool_call that carries plain text in one argument."""
    return _make_tool_call(tool_name, json.dumps({text_arg: text}, ensure_ascii=False))


def maybe_tool_call_prefix(text: str) -> bool:
    """True if the accumulated streamed text might be the start of a JSON tool
    call, so the streamer should buffer instead of emitting it as content.

    Handles the partial case where the full JSON hasn't arrived yet, e.g.
    '[{"name": "u_read_file", "arguments":' — which is not yet parseable but
    clearly a tool call in progress.
    """
    if not text:
        return False
    stripped = text.lstrip()
    if not stripped:
        return False
    # Allow an optional markdown fence opening
    if stripped.startswith("```"):
        stripped = stripped[3:].lstrip()
        if stripped[:4].lower() == "json":
            stripped = stripped[4:].lstrip()
    if not stripped:
        # only a fence so far — could go either way, buffer briefly
        return True
    # Must begin with a JSON container to be a candidate
    if stripped[0] not in "[{":
        return False
    # If it already parses as a tool call, definitely yes
    if has_tool_calls(stripped):
        return True
    # Partial: contains tool-call signals but isn't complete yet
    return any(sig in stripped for sig in ('"name"', '"tool_call"', '"tool_name"')) or stripped in "[{"
