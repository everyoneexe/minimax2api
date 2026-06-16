"""API proxy layer — forwards OpenAI-format requests to MiniMax web agent."""

import json
import logging
import time
from typing import AsyncGenerator, Optional
from contextlib import asynccontextmanager

from fastapi import HTTPException

from config import config_manager, usage_tracker, resolve_model, Account
from minimax_adapter import (
    web_agent_chat,
    web_agent_chat_stream,
    test_adapter,
)

logger = logging.getLogger("minimax2api.proxy")

_TRANSIENT_ERRORS = [
    "TRANSIENT_ERROR", "Session creation", "ValueError", "TypeError",
    "unpack", "too many values", "Protocol error", "connection", "timeout",
    "Timeout", "Connection", "No token", "pool", "lazy_server error",
]


# ── Runtime concurrency tracking ────────────────────────────────
# Maps account email -> current concurrent request count (runtime only, not persisted)
_account_concurrent: dict[str, int] = {}
_concurrent_lock = __import__("threading").Lock()


def _get_account_concurrent(email: str) -> int:
    """Get current concurrent request count for account."""
    with _concurrent_lock:
        return _account_concurrent.get(email, 0)


def _increment_concurrent(email: str):
    """Increment concurrent request count for account."""
    with _concurrent_lock:
        _account_concurrent[email] = _account_concurrent.get(email, 0) + 1
        logger.debug("Account '%s' concurrent: %d", email, _account_concurrent[email])


def _decrement_concurrent(email: str):
    """Decrement concurrent request count for account."""
    with _concurrent_lock:
        current = _account_concurrent.get(email, 0)
        if current > 0:
            _account_concurrent[email] = current - 1
            logger.debug("Account '%s' concurrent: %d (released)", email, _account_concurrent[email])


@asynccontextmanager
async def _track_concurrent(email: str):
    """Context manager to track concurrent requests for an account."""
    _increment_concurrent(email)
    try:
        yield
    finally:
        _decrement_concurrent(email)


# ── Account helpers ──────────────────────────────────────────────

def _get_creds(acct: Account) -> tuple:
    return "", "", acct.cookie


def _pick_account() -> Optional[Account]:
    accounts = config_manager.get_accounts()
    if not accounts:
        return None

    now = time.time()
    available = []
    for a in accounts:
        if a.depleted or not a.is_active:
            continue

        # Check temporary credit exhaustion
        if a.temporarily_no_credits:
            if a.credits_check_after > now:
                # Still in cooldown, skip
                continue
            else:
                # Cooldown expired, clear flag and try again
                # Note: This is done here (in-memory) before selection
                # The actual persist happens after successful use via _mark_used
                a.temporarily_no_credits = False
                a.credits_check_after = 0.0
                logger.info("Account '%s' (%s) cooldown expired - will clear flag after successful use", a.name, a.email)

        # Check concurrency limit
        current_concurrent = _get_account_concurrent(a.email)
        max_concurrent = a.max_concurrent if hasattr(a, 'max_concurrent') else 5
        if current_concurrent >= max_concurrent:
            logger.debug("Account '%s' at capacity (%d/%d), skipping", a.name, current_concurrent, max_concurrent)
            continue

        available.append(a)

    if not available:
        return None

    # Sort by load (current_concurrent) then last_used
    available.sort(key=lambda a: (_get_account_concurrent(a.email), a.last_used))
    chosen = available[0]

    # If this account just came out of cooldown, persist the flag clear now
    if chosen.temporarily_no_credits is False and chosen.credits_check_after == 0.0:
        # Check if it was actually in cooldown before (by checking config again)
        for a in config_manager.get_accounts():
            if a.email == chosen.email or a.name == chosen.name:
                if a.temporarily_no_credits:
                    # It was in cooldown, persist the clear
                    _persist_account(chosen)
                    logger.info("Account '%s' (%s) cooldown flag cleared and persisted", chosen.name, chosen.email)
                break

    return chosen


def _mark_used(acct: Account):
    """Update account usage stats in-memory only (not persisted every request to avoid write amplification)."""
    acct.last_used = time.time()
    acct.request_count += 1
    # Note: Usage stats are not persisted on every request to avoid write amplification.
    # Critical state changes (depleted, temporarily_no_credits) are persisted immediately.


def _persist_account(acct: Account):
    """Atomically persist account state to config."""
    try:
        config_manager.update_account(acct)
    except Exception:
        logger.warning("Failed to persist account state for '%s'", acct.name)


def _mark_quota_exceeded(acct: Account):
    """Mark account as depleted when quota is exhausted (permanent)."""
    acct.depleted = True
    acct.is_active = False
    _persist_account(acct)
    logger.warning("Account '%s' (%s) marked as PERMANENTLY depleted - quota exceeded", acct.name, acct.email)


def _mark_temporarily_no_credits(acct: Account):
    """Mark account as temporarily out of credits (24h cooldown, then auto-retry)."""
    acct.temporarily_no_credits = True
    acct.credits_check_after = time.time() + (24 * 60 * 60)  # 24 hours from now
    _persist_account(acct)
    logger.warning("Account '%s' (%s) marked as temporarily no credits - will retry after 24h", acct.name, acct.email)


def _find_account_by_email(email: str) -> Optional[Account]:
    """Find account by email for lazy mode identity correction."""
    if not email:
        return None
    for a in config_manager.get_accounts():
        if a.email == email:
            return a
    return None


def _extract_lazy_account(err: str) -> Optional[Account]:
    """Extract lazy_account email from error string and return the real account."""
    if "|lazy_account:" in err:
        email = err.split("|lazy_account:", 1)[1].split()[0].strip()
        return _find_account_by_email(email)
    return None


# ── Public API: chat completion ──────────────────────────────────

async def proxy_chat(model: str, messages: list, params: dict, proxy_key: str) -> dict:
    acct = _pick_account()
    if not acct:
        raise HTTPException(status_code=503, detail={
            "error": {"message": "No available accounts", "type": "unavailable"},
        })

    resolved_model = resolve_model(model)
    jwt_token, user_id, cookie = _get_creds(acct)
    account_email = acct.email
    tools = params.get("tools")
    user_agent = params.get("_user_agent", "")
    is_agent_client = any(x in user_agent.lower() for x in ["roo", "cline", "vscode"])
    if not is_agent_client:
        tools = None

    logger.debug("REQUEST body: model=%s ua=%s tools=%s", resolved_model, user_agent, json.dumps(tools))

    async with _track_concurrent(account_email):
        try:
            result = await web_agent_chat(resolved_model, messages, jwt_token, user_id, cookie=cookie, tools=tools, account_email=account_email)
            logger.debug("RESPONSE body: %s", json.dumps(result))
            _mark_used(acct)
            usage_tracker.record(proxy_key, resolved_model, 0, 0)
            return result
        except Exception as e:
            err = str(e)
            real_acct = _extract_lazy_account(err) or acct
            if "QUOTA_EXCEEDED" in err:
                # Permanent quota exceeded
                _mark_quota_exceeded(real_acct)
            elif "NO_CREDITS" in err:
                # Temporary credit exhaustion (24h cooldown)
                _mark_temporarily_no_credits(real_acct)
            elif any(x in err for x in _TRANSIENT_ERRORS):
                logger.warning("Account '%s' transient/infra error: %s", real_acct.name, err[:100])
            else:
                logger.warning("Account '%s' upstream error: %s", real_acct.name, err[:100])
            raise HTTPException(
                status_code=503,
                detail={"error": {"message": err.split("|lazy_account:")[0], "type": "upstream_error"}},
            )


async def proxy_chat_stream(
    model: str, messages: list, params: dict, proxy_key: str
) -> AsyncGenerator[str, None]:
    acct = _pick_account()
    if not acct:
        yield f"data: {json.dumps({'error': {'message': 'No available accounts', 'type': 'unavailable'}})}\n\n"
        yield "data: [DONE]\n\n"
        return

    jwt_token, user_id, cookie = _get_creds(acct)
    account_email = acct.email
    resolved_model = resolve_model(model)
    tools = params.get("tools")
    user_agent = params.get("_user_agent", "")
    is_agent_client = any(x in user_agent.lower() for x in ["roo", "cline", "vscode"])
    if not is_agent_client:
        tools = None

    logger.debug("STREAM REQUEST: model=%s ua=%s tools=%s", resolved_model, user_agent, json.dumps(tools))

    async with _track_concurrent(account_email):
        try:
            async for chunk in web_agent_chat_stream(resolved_model, messages, jwt_token, user_id, cookie=cookie, tools=tools, account_email=account_email):
                yield chunk
            _mark_used(acct)
            usage_tracker.record(proxy_key, resolved_model, 0, 0)
        except Exception as e:
            err = str(e)
            real_acct = _extract_lazy_account(err) or acct
            if "QUOTA_EXCEEDED" in err:
                _mark_quota_exceeded(real_acct)
            elif "NO_CREDITS" in err:
                _mark_temporarily_no_credits(real_acct)
            elif any(x in err for x in _TRANSIENT_ERRORS):
                logger.warning("Account '%s' stream transient/infra error: %s", real_acct.name, err[:100])
            else:
                logger.warning("Account '%s' stream upstream error: %s", real_acct.name, err[:100])
            clean_err = err.split("|lazy_account:")[0]
            yield f"data: {json.dumps({'error': {'message': clean_err, 'type': 'upstream_error'}})}\n\n"
            yield "data: [DONE]\n\n"


# ── Test / status ────────────────────────────────────────────────

async def test_connection() -> dict:
    acct = _pick_account()
    if not acct:
        return {"success": False, "error": "No accounts configured"}
    return await _test_account(acct)


async def test_account_by_index(idx: int) -> dict:
    accounts = config_manager.get_accounts()
    if idx < 0 or idx >= len(accounts):
        return {"success": False, "error": f"Index {idx} out of range"}
    return await _test_account(accounts[idx])


async def _test_account(acct: Account) -> dict:
    from minimax_adapter.pool import get_pooled_session
    from minimax_adapter.session import stream_message
    import time as _time

    jwt_token, user_id, cookie = _get_creds(acct)

    # Token yoksa pool'dan session al
    if not jwt_token:
        pooled = get_pooled_session("", "")
        if not pooled:
            return {"success": False, "error": "No token and no pool sessions available"}
        session_id, jwt_token, user_id, device_id, uuid_val, _session_email = pooled
        try:
            final_content = ""
            async for event in stream_message(session_id, jwt_token, user_id, "Hi", "MiniMax-M2.7", device_id=device_id, uuid_val=uuid_val):
                if event.get("type") == 6:
                    chunk = event.get("agent_message_chunk", {})
                    if chunk.get("msg_content"):
                        final_content += chunk["msg_content"]
                    if chunk.get("finish"):
                        break
                elif event.get("type") == 2:
                    final_content = event.get("agent_message", {}).get("msg_content", final_content)
                    break
            return {"success": True, "response": final_content[:200], "model": "MiniMax-M2.7", "source": "pool"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return await test_adapter(jwt_token, user_id, cookie=cookie)


def get_accounts_status() -> list[dict]:
    accounts = config_manager.get_accounts()
    result = []
    for a in accounts:
        current_concurrent = _get_account_concurrent(a.email)
        max_concurrent = a.max_concurrent if hasattr(a, 'max_concurrent') else 5
        result.append({
            "name": a.name,
            "email": a.email,
            "is_active": a.is_active,
            "depleted": getattr(a, 'depleted', False),
            "temporarily_no_credits": getattr(a, 'temporarily_no_credits', False),
            "request_count": a.request_count,
            "last_used": a.last_used,
            "auth_mode": a.auth_mode,
            "max_concurrent": max_concurrent,
            "current_concurrent": current_concurrent,
        })
    return result


async def fetch_models() -> dict:
    return {
        "object": "list",
        "data": [
            {"id": m, "object": "model", "created": 1681940951, "owned_by": "minimax"}
            for m in config_manager.config.available_models
        ],
    }
