"""Session creation and message streaming for MiniMax adapter."""

import json
import logging
from typing import AsyncGenerator

logger = logging.getLogger("minimax2api.adapter.session")

# Constants
AGENT_BASE_URL = "https://agent.minimax.io"
STREAM_BASE_URL = "https://agent-stream.minimax.io"
DEFAULT_AGENT_ID = "404574372720710"
DEFAULT_MODEL = "MiniMax-M2.7"
PROXY_URL = ""  # Set via env MINIMAX_PROXY or config


async def create_session(
    jwt_token: str,
    user_id: str,
    model: str = DEFAULT_MODEL,
    agent_id: str = DEFAULT_AGENT_ID,
    cookie: str = "",
    proxy: str = "",
) -> str:
    """Create a new chat session and return session_id.

    Args:
        jwt_token: JWT authentication token
        user_id: User ID
        model: Model name (default: MiniMax-M3)
        agent_id: Agent ID (default: 404574372720710)
        cookie: Optional cookie string for authentication
        proxy: Optional proxy URL

    Returns:
        Session ID string

    Raises:
        RuntimeError: If session creation fails
    """
    from curl_cffi.requests import AsyncSession
    from .utils import unix_timestamp
    from .signing import build_url, build_signed_headers

    ts_s = unix_timestamp()
    ts_ms = ts_s * 1000
    device_id = "62532107"

    # Build model object with correct format
    # Only MiniMax-M3 (no thinking) → variant: ""
    # All others → variant: "thinking"
    model_id = model.replace("-thinking", "") if "thinking" in model else model
    variant = "" if model == "MiniMax-M3" else "thinking"

    body = {
        "model": {
            "provider_id": "minimax",
            "model_id": model_id,
            "variant": variant
        }
    }
    body_str = json.dumps(body, separators=(",", ":"))

    path = f"/archon/api/v1/agent/{agent_id}/session"
    url = f"{AGENT_BASE_URL}{build_url(path, jwt_token, user_id, device_id, ts_ms)}"

    headers = build_signed_headers(jwt_token, url, body_str, ts_s)
    headers["Sec-Fetch-Dest"] = "empty"
    headers["Sec-Fetch-Mode"] = "cors"
    headers["Sec-Fetch-Site"] = "same-origin"

    if cookie:
        # Cookie mode: use subprocess curl (for cookie pair matching)
        import subprocess
        cmd = ["curl", "-s", url, "-X", "POST"]
        for k, v in headers.items():
            cmd += ["-H", f"{k}: {v}"]
        cmd += ["-H", f"Cookie: {cookie}", "--data-raw", body_str]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            raise RuntimeError(f"curl failed: {result.stderr[:200]}")
        try:
            data = json.loads(result.stdout)
        except Exception:
            raise RuntimeError(f"Session creation failed: {result.stdout[:200]}")
        session_id = str(data.get("session_id") or data.get("id") or "")
        if not session_id:
            raise RuntimeError(f"No session_id in response: {result.stdout[:200]}")
        logger.info("Session created (curl): %s", session_id)
        return session_id

    proxies = {"https": proxy or PROXY_URL} if (proxy or PROXY_URL) else None

    async with AsyncSession(impersonate="firefox", proxies=proxies) as s:
        # Visit homepage first to get ak_bmsc Akamai cookie
        try:
            await s.get(AGENT_BASE_URL + "/", timeout=10)
        except Exception:
            pass

        s.cookies.set("_token", jwt_token, domain=".minimax.io", path="/")
        resp = await s.post(url, data=body_str, headers=headers, timeout=15)

    if resp.status_code != 200:
        raise RuntimeError(f"Session creation failed: HTTP {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    session_id = str(data.get("session_id") or data.get("id") or "")
    if not session_id:
        raise RuntimeError(f"No session_id in response: {resp.text[:200]}")

    logger.info("Session created: %s", session_id)
    return session_id


async def stream_message(
    session_id: str,
    jwt_token: str,
    user_id: str,
    content: str,
    model: str,
    cookie: str = "",
    proxy: str = "",
    device_id: str = "62532107",
    uuid_val: str = "6cafb2f8-5868-4755-a50b-c54f9a7edc4a",
) -> AsyncGenerator[dict, None]:
    """Send a message and yield SSE event dicts.

    Args:
        session_id: Chat session ID
        jwt_token: JWT authentication token
        user_id: User ID
        content: Message content to send
        model: Model name
        cookie: Optional cookie string
        proxy: Optional proxy URL
        device_id: Device ID
        uuid_val: UUID value

    Yields:
        Dictionary for each SSE event received

    Raises:
        RuntimeError: If message sending fails
    """
    from curl_cffi.requests import AsyncSession
    from .utils import unix_timestamp
    from .signing import build_url, build_signed_headers

    ts_s = unix_timestamp()
    ts_ms = ts_s * 1000

    # Build model object with correct format
    # Only MiniMax-M3 (no thinking) → variant: ""
    # All others → variant: "thinking"
    model_id = model.replace("-thinking", "") if "thinking" in model else model
    variant = "" if model == "MiniMax-M3" else "thinking"

    body = {
        "role": "user",
        "content": content,
        "model": {
            "provider_id": "minimax",
            "model_id": model_id,
            "variant": variant
        }
    }
    body_str = json.dumps(body, separators=(",", ":"))

    path = f"/archon/api/v1/session/{session_id}/message"
    url = f"{STREAM_BASE_URL}{build_url(path, jwt_token, user_id, device_id, ts_ms, uuid_val)}"

    headers = build_signed_headers(jwt_token, url, body_str, ts_s)
    headers["Accept"] = "text/event-stream"
    headers["Sec-Fetch-Dest"] = "empty"
    headers["Sec-Fetch-Mode"] = "cors"
    headers["Sec-Fetch-Site"] = "cross-site"

    if cookie:
        # Cookie mode: use subprocess curl for streaming
        import subprocess
        cmd = ["curl", "-sN", url, "-X", "POST"]
        for k, v in headers.items():
            cmd += ["-H", f"{k}: {v}"]
        cmd += ["-H", f"Cookie: {cookie}", "--data-raw", body_str]

        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        try:
            for line in iter(proc.stdout.readline, ""):
                line_str = line.strip()
                if not line_str or not line_str.startswith("data:"):
                    continue
                raw = line_str[5:].strip()
                if not raw:
                    continue
                try:
                    event = json.loads(raw)
                    # Check for quota/limit errors
                    err_msg = ""
                    if event.get("base_resp", {}).get("status_code") not in (0, None):
                        err_msg = event.get("base_resp", {}).get("status_msg", "")
                    if event.get("error"):
                        err_msg = str(event.get("error", ""))
                    if err_msg and any(k in err_msg.lower() for k in ["quota", "limit", "exceeded", "rate", "credit", "insufficient"]):
                        raise RuntimeError(f"QUOTA_EXCEEDED: {err_msg}")
                    # finish_reason:error — transient error, skip
                    if event.get("type") == 2:
                        msg = event.get("agent_message", {})
                        if msg.get("finish_reason") == "error" and not msg.get("msg_content"):
                            raise RuntimeError("TRANSIENT_ERROR: finish_reason=error")
                    if event.get("type") == 6:
                        chunk = event.get("agent_message_chunk", {})
                        if chunk.get("finish_reason") == "error" and chunk.get("finish"):
                            raise RuntimeError("TRANSIENT_ERROR: finish_reason=error")
                    yield event
                except json.JSONDecodeError:
                    continue
        finally:
            proc.terminate()
            proc.wait(timeout=5)
        return

    proxies = {"https": proxy or PROXY_URL} if (proxy or PROXY_URL) else None

    async with AsyncSession(impersonate="firefox", proxies=proxies) as s:
        s.cookies.set("_token", jwt_token, domain=".minimax.io", path="/")

        async with s.stream("POST", url, data=body_str, headers=headers, timeout=120) as resp:
            if resp.status_code != 200:
                text = await resp.atext()
                raise RuntimeError(f"Message failed: HTTP {resp.status_code}: {text[:200]}")

            async for line in resp.aiter_lines():
                # aiter_lines() returns bytes, need to decode
                if isinstance(line, bytes):
                    line = line.decode('utf-8', errors='ignore')
                line_str = line.strip()
                if not line_str or not line_str.startswith("data:"):
                    continue
                raw = line_str[5:].strip()
                if not raw:
                    continue
                try:
                    event = json.loads(raw)
                    # Check for quota/limit errors
                    err_msg = ""
                    if event.get("base_resp", {}).get("status_code") not in (0, None):
                        err_msg = event.get("base_resp", {}).get("status_msg", "")
                    if event.get("error"):
                        err_msg = str(event.get("error", ""))
                    if err_msg and any(k in err_msg.lower() for k in ["quota", "limit", "exceeded", "rate", "credit", "insufficient"]):
                        raise RuntimeError(f"QUOTA_EXCEEDED: {err_msg}")
                    # finish_reason:error — transient error, skip
                    if event.get("type") == 2:
                        msg = event.get("agent_message", {})
                        if msg.get("finish_reason") == "error" and not msg.get("msg_content"):
                            raise RuntimeError("TRANSIENT_ERROR: finish_reason=error")
                    if event.get("type") == 6:
                        chunk = event.get("agent_message_chunk", {})
                        if chunk.get("finish_reason") == "error" and chunk.get("finish"):
                            raise RuntimeError("TRANSIENT_ERROR: finish_reason=error")
                    yield event
                except json.JSONDecodeError:
                    continue
