"""Session pool management for MiniMax adapter.

Manages a pool of pre-authenticated sessions for high-throughput API usage.
Sessions are stored in pool_sessions.json and have a 25-minute TTL.
"""

import json
import threading
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional
import time

_pool_lock = threading.Lock()
_POOL_FILE = Path(__file__).parent.parent / "pool_sessions.json"


def load_pool() -> list:
    """Load sessions from pool file.

    Returns:
        List of session dictionaries
    """
    if not _POOL_FILE.exists():
        return []
    try:
        with open(_POOL_FILE, "r") as f:
            return json.load(f).get("sessions", [])
    except Exception:
        return []


def save_pool(sessions: list):
    """Save sessions to pool file.

    Args:
        sessions: List of session dictionaries to save
    """
    with open(_POOL_FILE, "w") as f:
        json.dump({
            "sessions": sessions,
            "updated_at": datetime.now().isoformat()
        }, f, indent=2)


def get_pooled_session(
    jwt_token: str,
    user_id: str,
    account_email: str = ""
) -> Optional[tuple[str, str, str, str, str, str]]:
    """Get a valid session from pool.

    Thread-safe retrieval of a session from the pool. The session is
    removed from the pool after retrieval.

    Args:
        jwt_token: JWT token (used as fallback if session token missing)
        user_id: User ID (used as fallback if session user_id missing)
        account_email: Preferred account email (for account-specific routing)

    Returns:
        Tuple of (session_id, token, user_id, device_id, uuid, session_account_email)
        or None if no valid sessions available
    """
    with _pool_lock:
        sessions = load_pool()
        now_ts = time.time()
        valid = []

        # Filter valid (non-expired) sessions
        for s in sessions:
            try:
                exp_str = s["expires_at"].replace("Z", "+00:00")
                from datetime import timezone
                exp_dt = datetime.fromisoformat(exp_str)
                if exp_dt.timestamp() > now_ts:
                    valid.append(s)
            except Exception:
                # If parsing fails, keep session (assume valid)
                valid.append(s)

        if not valid:
            return None

        # Prefer session matching the account email
        session = None
        if account_email:
            session = next((s for s in valid if s.get("account_email") == account_email), None)
        if not session:
            session = valid[0]

        # Remove session from pool
        sessions.remove(session)
        save_pool(sessions)

        # Extract session data with fallbacks
        sid = session.get("session_id") or session.get("sessionId") or ""
        tok = session.get("token") or jwt_token
        uid = session.get("user_id") or session.get("userId") or user_id
        did = session.get("device_id") or "62532107"
        uuid_val = session.get("uuid") or "6cafb2f8-5868-4755-a50b-c54f9a7edc4a"
        session_email = session.get("account_email", "")

        return sid, tok, uid, did, uuid_val, session_email


def return_session(jwt_token: str, user_id: str, session_id: str):
    """Return a session back to pool after use.

    Thread-safe return of a session to the pool with refreshed TTL.

    Args:
        jwt_token: JWT token
        user_id: User ID
        session_id: Session ID to return
    """
    with _pool_lock:
        sessions = load_pool()
        sessions.append({
            "session_id": session_id,
            "token": jwt_token,
            "user_id": user_id,
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + timedelta(minutes=25)).isoformat()
        })
        save_pool(sessions)


def pool_size() -> int:
    """Return number of valid (non-expired) sessions in pool.

    Returns:
        Count of valid sessions
    """
    now = datetime.now()
    sessions = load_pool()
    count = 0

    for s in sessions:
        try:
            exp_dt = datetime.fromisoformat(s["expires_at"].replace("Z", "+00:00"))
            if exp_dt.replace(tzinfo=None) > now:
                count += 1
        except Exception:
            # If parsing fails, assume valid
            count += 1

    return count


def parse_token(raw_token: str) -> tuple:
    """Parse a raw token string into components.

    Args:
        raw_token: Token string in format "token:user_id" or just "token"

    Returns:
        Tuple of (token, user_id)
    """
    if ":" in raw_token:
        parts = raw_token.split(":", 1)
        return parts[0], parts[1]
    return raw_token, ""
