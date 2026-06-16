"""SSE (Server-Sent Events) streaming utilities."""

import json
from typing import Optional
from .utils import unix_timestamp


def sse_chunk(chat_id: str, model: str, delta: dict, finish_reason: Optional[str] = None) -> str:
    """Build an SSE-formatted chunk for OpenAI-compatible streaming.

    Args:
        chat_id: Chat completion ID
        model: Model name
        delta: Delta dictionary (content, role, etc.)
        finish_reason: Optional finish reason (stop, tool_calls, etc.)

    Returns:
        SSE-formatted string with "data: " prefix
    """
    chunk = {
        "id": f"chatcmpl-{chat_id}",
        "object": "chat.completion.chunk",
        "created": unix_timestamp(),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
