"""Main chat client for MiniMax adapter.

This module provides the public API for chatting with MiniMax Web Agent,
supporting both pool mode (pre-authenticated sessions) and lazy mode
(on-demand browser automation).
"""

import json
import logging
import os
import re
from typing import AsyncGenerator, Optional
from pathlib import Path

logger = logging.getLogger("minimax2api.adapter.client")

# Constants
AGENT_BASE_URL = "https://agent.minimax.io"
DEFAULT_MODEL = "MiniMax-M2.7"
_LAZY_SERVER_PORT = int(os.environ.get("LAZY_PORT", "5005"))


async def resolve_asset_urls(
    content: str,
    jwt_token: str,
    user_id: str,
    device_id: str = "62532107"
) -> str:
    """Replace commit-id-XXX references in <deliver-assets> with real download URLs.

    Args:
        content: Message content containing commit-id references
        jwt_token: JWT authentication token
        user_id: User ID
        device_id: Device ID

    Returns:
        Content with commit-id references replaced by download URLs
    """
    if not content or "deliver-assets" not in content:
        return content

    # Find all commit-id references
    commit_ids = re.findall(r'commit-id-(\d+)', content)
    if not commit_ids:
        return content

    from curl_cffi.requests import AsyncSession
    from .utils import unix_timestamp
    from .signing import build_url, build_signed_headers

    async with AsyncSession(impersonate="firefox") as s:
        for file_id in commit_ids:
            ts_s = unix_timestamp()
            ts_ms = ts_s * 1000
            path = f"/archon/api/v1/drive/file/{file_id}/download-url"
            url = f"{AGENT_BASE_URL}{build_url(path, jwt_token, user_id, device_id, ts_ms)}"
            headers = build_signed_headers(jwt_token, url, "", ts_s)
            try:
                resp = await s.get(url, headers=headers, timeout=10)
                if resp.status_code == 200:
                    data = resp.json()
                    download_url = data.get("download_url") or data.get("url") or data.get("data", {}).get("download_url", "")
                    if download_url:
                        content = content.replace(f"commit-id-{file_id}", download_url)
            except Exception as e:
                logger.warning("Asset resolve failed for %s: %s", file_id, e)

    return content


def messages_to_content(messages: list) -> str:
    """Convert OpenAI messages list to a single content string.

    Args:
        messages: List of OpenAI-format message dictionaries

    Returns:
        Formatted content string suitable for MiniMax API
    """
    system_text = ""
    parts = []

    for m in messages:
        content = ""
        if isinstance(m.get("content"), str):
            content = m["content"]
        elif isinstance(m.get("content"), list):
            content = "\n".join(
                p.get("text", "") for p in m["content"] if p.get("type") == "text"
            )
        if not content:
            continue
        if m.get("role") == "system":
            system_text = content
        else:
            parts.append(f"{m['role']}: {content}")

    # Simple single-message case
    if len(parts) == 1 and not system_text:
        last = messages[-1] if messages else {}
        c = last.get("content", "")
        return c if isinstance(c, str) else "\n".join(
            p.get("text", "") for p in c if p.get("type") == "text"
        )

    # Multi-turn conversation format
    result_parts = []
    if system_text:
        result_parts.append(f"[System: {system_text}]")
    result_parts.extend(parts)
    return "\n".join(result_parts) or "hi"


async def lazy_chat_http(content: str, model: str) -> dict:
    """Send request to lazy_server.js HTTP endpoint.

    Args:
        content: Message content
        model: Model name

    Returns:
        Response dictionary from lazy server

    Raises:
        RuntimeError: If lazy server communication fails
    """
    import httpx
    url = f"http://localhost:{_LAZY_SERVER_PORT}/chat"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json={"message": content, "model": model})
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
            return resp.json()
    except (httpx.HTTPError, ValueError) as e:
        raise RuntimeError(f"lazy_server error: {e}") from e


async def web_agent_chat(
    model: str,
    messages: list,
    jwt_token: str,
    user_id: str,
    cookie: str = "",
    tools: list = None,
    account_email: str = "",
) -> dict:
    """Non-streaming chat. Returns OpenAI-compatible response dict.

    Args:
        model: Model name
        messages: List of OpenAI-format messages
        jwt_token: JWT authentication token
        user_id: User ID
        cookie: Optional cookie string
        tools: Optional list of tool definitions
        account_email: Optional account email for routing

    Returns:
        OpenAI-compatible chat completion response dictionary

    Raises:
        RuntimeError: If chat request fails
    """
    from tool_call import inject_tools_into_messages, parse_tool_calls, strip_tool_calls, has_tool_calls
    from .utils import generate_uuid, unix_timestamp
    from .pool import get_pooled_session
    from .session import create_session, stream_message

    if tools:
        messages = inject_tools_into_messages(messages, tools)

    content = messages_to_content(messages)
    final_content = ""
    final_thinking = ""

    # Lazy mode: Puppeteer on-demand session
    from config import config_manager as _cm
    lazy = _cm.config.lazy_session

    if lazy:
        result = await lazy_chat_http(content, model)
        lazy_account_email = result.get("account_email", account_email)
        if "error" in result:
            msg = result["error"]
            # NO_CREDITS = temporary (24h cooldown), QUOTA_EXCEEDED = permanent
            if "NO_CREDITS" in msg:
                raise RuntimeError(f"NO_CREDITS: {msg}|lazy_account:{lazy_account_email}")
            if "QUOTA_EXCEEDED" in msg:
                raise RuntimeError(f"QUOTA_EXCEEDED: {msg}|lazy_account:{lazy_account_email}")
            raise RuntimeError(f"lazy_server error: {msg}|lazy_account:{lazy_account_email}")

        final_content = result.get("content", "")
        final_thinking = result.get("thinking", "")
        lazy_usage = result.get("usage") or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

        # Resolve asset URLs (only if we have credentials)
        if "commit-id-" in final_content and jwt_token:
            final_content = await resolve_asset_urls(final_content, jwt_token, user_id, "62532107")

        choice: dict = {
            "index": 0,
            "message": {"role": "assistant", "content": final_content},
            "finish_reason": "stop",
        }
        if final_thinking:
            choice["message"]["reasoning_content"] = final_thinking

        # Parse tool calls
        if tools and has_tool_calls(final_content):
            tool_calls = parse_tool_calls(final_content)
            if tool_calls:
                choice["message"]["content"] = strip_tool_calls(final_content) or None
                choice["message"]["tool_calls"] = tool_calls
                choice["finish_reason"] = "tool_calls"

        return {
            "id": f"chatcmpl-lazy-{generate_uuid()[:8]}",
            "object": "chat.completion",
            "created": unix_timestamp(),
            "model": model,
            "choices": [choice],
            "usage": lazy_usage,
        }

    # Non-lazy: Get session from pool or create new
    pooled = get_pooled_session(jwt_token, user_id, account_email)
    if pooled:
        session_id, jwt_token, user_id, pool_device_id, pool_uuid, session_email = pooled
        logger.info("Session retrieved from pool: %s (owner: %s)", session_id, session_email or "?")
        account_email = session_email or account_email
    else:
        logger.info("Pool empty, creating new session...")
        pool_device_id = "62532107"
        pool_uuid = "6cafb2f8-5868-4755-a50b-c54f9a7edc4a"
        session_id = await create_session(jwt_token, user_id, model, cookie=cookie)

    usage_data = {}

    async for event in stream_message(session_id, jwt_token, user_id, content, model, cookie=cookie, device_id=pool_device_id, uuid_val=pool_uuid):
        etype = event.get("type")
        if etype == 2:
            msg = event.get("agent_message", {})
            if msg.get("role") == "assistant":
                c = msg.get("msg_content", "")
                if c:
                    final_content = c
                t = msg.get("thinking_content", "")
                if t:
                    final_thinking = t
                # Capture usage data
                if msg.get("usage"):
                    u = msg["usage"]
                    input_tok = u.get("input_tokens") or u.get("prompt_tokens") or max(0, u.get("total_tokens", 0) - u.get("output_tokens", 0))
                    output_tok = u.get("output_tokens", 0)
                    total_tok = u.get("total_tokens", 0)
                    usage_data = {
                        "prompt_tokens": input_tok,
                        "completion_tokens": output_tok,
                        "total_tokens": total_tok,
                    }
                fr = msg.get("finish_reason")
                if fr in ("stop", "length", "tool_calls") or (fr is None and c):
                    break
        elif etype == 6:
            chunk = event.get("agent_message_chunk", {})
            if chunk.get("role") == "assistant":
                if chunk.get("msg_content"):
                    final_content += chunk["msg_content"]
                if chunk.get("thinking_content"):
                    final_thinking += chunk["thinking_content"]

    # Resolve asset URLs (commit-id → download URL)
    if "commit-id-" in final_content:
        final_content = await resolve_asset_urls(final_content, jwt_token, user_id, pool_device_id)

    choice: dict = {
        "index": 0,
        "message": {"role": "assistant", "content": final_content},
        "finish_reason": "stop",
    }
    if final_thinking:
        choice["message"]["reasoning_content"] = final_thinking

    # Tool call parsing
    if tools and has_tool_calls(final_content):
        tool_calls = parse_tool_calls(final_content)
        if tool_calls:
            choice["message"]["content"] = strip_tool_calls(final_content) or None
            choice["message"]["tool_calls"] = tool_calls
            choice["finish_reason"] = "tool_calls"

    return {
        "id": f"chatcmpl-{session_id}",
        "object": "chat.completion",
        "created": unix_timestamp(),
        "model": model,
        "choices": [choice],
        "usage": usage_data or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


async def web_agent_chat_stream(
    model: str,
    messages: list,
    jwt_token: str,
    user_id: str,
    cookie: str = "",
    tools: list = None,
    account_email: str = "",
) -> AsyncGenerator[str, None]:
    """Streaming chat. Yields OpenAI-compatible SSE chunks.

    Args:
        model: Model name
        messages: List of OpenAI-format messages
        jwt_token: JWT authentication token
        user_id: User ID
        cookie: Optional cookie string
        tools: Optional list of tool definitions
        account_email: Optional account email for routing

    Yields:
        SSE-formatted strings for streaming response

    Raises:
        RuntimeError: If chat request fails
    """
    from tool_call import inject_tools_into_messages, parse_tool_calls, strip_tool_calls, has_tool_calls
    from .utils import generate_uuid
    from .pool import get_pooled_session
    from .session import create_session, stream_message
    from .streaming import sse_chunk

    if tools:
        messages = inject_tools_into_messages(messages, tools)

    content = messages_to_content(messages)

    # Lazy mode: Puppeteer on-demand session
    from config import config_manager as _cm
    lazy = _cm.config.lazy_session

    if lazy:
        chat_id = f"chatcmpl-lazy-{generate_uuid()[:8]}"
        result = await lazy_chat_http(content, model)
        lazy_account_email = result.get("account_email", account_email)
        if "error" in result:
            msg = result["error"]
            # NO_CREDITS = temporary (24h cooldown), QUOTA_EXCEEDED = permanent
            if "NO_CREDITS" in msg:
                raise RuntimeError(f"NO_CREDITS: {msg}|lazy_account:{lazy_account_email}")
            if "QUOTA_EXCEEDED" in msg:
                raise RuntimeError(f"QUOTA_EXCEEDED: {msg}|lazy_account:{lazy_account_email}")
            raise RuntimeError(f"lazy_server error: {msg}|lazy_account:{lazy_account_email}")

        try:
            final_content = result.get("content", "")
            final_thinking = result.get("thinking", "")

            # Resolve asset URLs (only if we have credentials)
            if "commit-id-" in final_content and jwt_token:
                final_content = await resolve_asset_urls(final_content, jwt_token, user_id, "62532107")

            # Check for tool calls
            if tools and has_tool_calls(final_content):
                tool_calls = parse_tool_calls(final_content)
                if tool_calls:
                    stripped = strip_tool_calls(final_content) or None
                    yield sse_chunk(chat_id, model, {"role": "assistant", "content": stripped, "tool_calls": tool_calls})
                    yield sse_chunk(chat_id, model, {}, finish_reason="tool_calls")
                    yield "data: [DONE]\n\n"
                    return

            if final_thinking:
                yield sse_chunk(chat_id, model, {"role": "assistant", "reasoning_content": final_thinking})
            yield sse_chunk(chat_id, model, {"role": "assistant", "content": final_content})
            yield sse_chunk(chat_id, model, {}, finish_reason="stop")
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': {'message': str(e), 'type': 'upstream_error'}})}\n\n"
            yield "data: [DONE]\n\n"
        return

    # Non-lazy: Get session from pool
    pooled = get_pooled_session(jwt_token, user_id, account_email)
    if pooled:
        session_id, jwt_token, user_id, pool_device_id, pool_uuid, session_email = pooled
        logger.info("Session retrieved from pool: %s (owner: %s)", session_id, session_email or "?")
        account_email = session_email or account_email
    else:
        logger.info("Pool empty, creating new session...")
        pool_device_id = "62532107"
        pool_uuid = "6cafb2f8-5868-4755-a50b-c54f9a7edc4a"
        session_id = None

    try:
        if session_id is None:
            session_id = await create_session(jwt_token, user_id, model, cookie=cookie)
        sent_role = False
        full_content = ""

        async for event in stream_message(session_id, jwt_token, user_id, content, model, cookie=cookie, device_id=pool_device_id, uuid_val=pool_uuid):
            etype = event.get("type")

            if etype == 6:
                chunk = event.get("agent_message_chunk", {})
                if chunk.get("role") != "assistant":
                    continue
                if not sent_role:
                    yield sse_chunk(session_id, model, {"role": "assistant"})
                    sent_role = True
                if chunk.get("thinking_content"):
                    yield sse_chunk(session_id, model, {"reasoning_content": chunk["thinking_content"]})
                if chunk.get("msg_content"):
                    full_content += chunk["msg_content"]
                    if not tools or not has_tool_calls(full_content):
                        yield sse_chunk(session_id, model, {"content": chunk["msg_content"]})
                if chunk.get("finish"):
                    # Resolve asset URLs if present
                    if "commit-id-" in full_content and jwt_token:
                        full_content = await resolve_asset_urls(full_content, jwt_token, user_id, pool_device_id)
                    # Tool call parsing
                    if tools and has_tool_calls(full_content):
                        tool_calls = parse_tool_calls(full_content)
                        if tool_calls:
                            cleaned = strip_tool_calls(full_content)
                            if cleaned:
                                yield sse_chunk(session_id, model, {"content": cleaned})
                            for tc in tool_calls:
                                yield sse_chunk(session_id, model, {"tool_calls": [{"index": 0, "id": tc["id"], "type": "function", "function": {"name": tc["function"]["name"], "arguments": ""}}]})
                                yield sse_chunk(session_id, model, {"tool_calls": [{"index": 0, "function": {"arguments": tc["function"]["arguments"]}}]})
                            yield sse_chunk(session_id, model, {}, finish_reason="tool_calls")
                        else:
                            yield sse_chunk(session_id, model, {}, finish_reason=chunk.get("finish_reason", "stop"))
                    else:
                        yield sse_chunk(session_id, model, {}, finish_reason=chunk.get("finish_reason", "stop"))

            elif etype == 2:
                msg = event.get("agent_message", {})
                if msg.get("role") == "assistant" and not sent_role:
                    yield sse_chunk(session_id, model, {"role": "assistant", "content": msg.get("msg_content", "")})
                    yield sse_chunk(session_id, model, {}, finish_reason="stop")

    except Exception as e:
        logger.error("Streaming error: %s", e)
        yield f"data: {json.dumps({'error': {'message': str(e), 'type': 'upstream_error'}})}\n\n"

    yield "data: [DONE]\n\n"


async def test_adapter(jwt_token: str, user_id: str, cookie: str = "", proxy: str = "") -> dict:
    """Test the adapter with a simple request.

    Args:
        jwt_token: JWT authentication token
        user_id: User ID
        cookie: Optional cookie string
        proxy: Optional proxy URL

    Returns:
        Dictionary with success status and response/error
    """
    from .session import create_session, stream_message

    try:
        session_id = await create_session(jwt_token, user_id, DEFAULT_MODEL, cookie=cookie, proxy=proxy)
        final_content = ""
        async for event in stream_message(session_id, jwt_token, user_id, "Hi", DEFAULT_MODEL, cookie=cookie, proxy=proxy):
            if event.get("type") == 6:
                chunk = event.get("agent_message_chunk", {})
                if chunk.get("finish"):
                    break
                if chunk.get("msg_content"):
                    final_content += chunk["msg_content"]
            elif event.get("type") == 2:
                msg = event.get("agent_message", {})
                if msg.get("role") == "assistant":
                    final_content = msg.get("msg_content", final_content)
                    break
        return {"success": True, "response": final_content[:200], "session_id": session_id}
    except Exception as e:
        return {"success": False, "error": str(e)}
