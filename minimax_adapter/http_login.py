"""HTTP login via Puppeteer JWT extraction."""

import json
import logging
import subprocess
import time
from pathlib import Path

logger = logging.getLogger("minimax2api.adapter.http_login")

EXTRACT_SCRIPT = Path(__file__).parent.parent / "generator" / "extract_jwt.js"


def extract_jwt(email: str, password: str, timeout: int = 90) -> dict:
    """Run extract_jwt.js and return {token, user_id, device_id, uuid, agent_id, cookies}.

    Raises RuntimeError on failure.
    """
    if not EXTRACT_SCRIPT.exists():
        raise RuntimeError(f"extract_jwt.js not found at {EXTRACT_SCRIPT}")

    try:
        result = subprocess.run(
            ["node", str(EXTRACT_SCRIPT), email, password],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(EXTRACT_SCRIPT.parent.parent),  # proje kök dizini
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"JWT extraction timed out after {timeout}s")

    stdout = result.stdout.strip()
    if not stdout:
        raise RuntimeError(f"No output from extract_jwt.js: {result.stderr[:200]}")

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"Invalid JSON from extract_jwt.js: {stdout[:200]}")

    if not data.get("success"):
        raise RuntimeError(f"JWT extraction failed: {data.get('error', 'unknown')}")

    return data


def get_or_refresh_token(acct) -> tuple:
    """Return (token, user_id, device_id, uuid_val, agent_id, cookies) for an account.

    Refreshes if token is missing or expired (with 5min buffer).
    Updates acct fields and saves to config.
    """
    from config import config_manager

    now = time.time()
    # 5 dakika buffer ile kontrol et
    if acct.saved_token and acct.token_expires > now + 300 and acct.saved_cookies:
        logger.info("Using cached token for %s (expires in %.0fs)", acct.email, acct.token_expires - now)
        cookie_str = "; ".join(f"{k}={v}" for k, v in acct.saved_cookies.items())
        return (
            acct.saved_token,
            acct.user_id or "",
            "62532107",
            "6cafb2f8-5868-4755-a50b-c54f9a7edc4a",
            acct.agent_id,
            cookie_str,
        )

    logger.info("Extracting JWT for %s...", acct.email)
    data = extract_jwt(acct.email, acct.password)

    token = data["token"]
    user_id = data["user_id"]
    device_id = data.get("device_id", "62532107")
    uuid_val = data.get("uuid", "6cafb2f8-5868-4755-a50b-c54f9a7edc4a")
    agent_id = data.get("agent_id", "")
    cookies_str = data.get("cookies", "")

    # JWT exp field'ından expiry al
    try:
        import base64
        payload = token.split(".")[1]
        payload += "=" * (4 - len(payload) % 4)
        claims = json.loads(base64.b64decode(payload))
        token_expires = float(claims.get("exp", now + 7 * 86400))
    except Exception:
        token_expires = now + 7 * 86400

    # Cookie string'i dict'e çevir ve kaydet
    saved_cookies = {}
    for part in cookies_str.split("; "):
        if "=" in part:
            k, v = part.split("=", 1)
            saved_cookies[k.strip()] = v.strip()

    acct.saved_token = token
    acct.token_expires = token_expires
    acct.agent_id = agent_id
    acct.user_id = user_id
    acct.saved_cookies = saved_cookies
    acct.cookies_expires = token_expires
    config_manager.update_account(acct)

    logger.info("JWT extracted for %s, expires in %.0fh", acct.email, (token_expires - now) / 3600)
    return token, user_id, device_id, uuid_val, agent_id, cookies_str
