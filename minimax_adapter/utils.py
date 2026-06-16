"""Utility functions for MiniMax adapter."""

import hashlib
import json
import time
import uuid as uuid_mod


def md5(s: str) -> str:
    """Generate MD5 hash of a string."""
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def unix_timestamp() -> int:
    """Get current Unix timestamp in seconds."""
    return int(time.time())


def generate_uuid() -> str:
    """Generate a random UUID string."""
    return str(uuid_mod.uuid4())


def parse_jwt_user_id(jwt_token: str) -> str:
    """Extract user.id from a MiniMax JWT token payload.

    Args:
        jwt_token: JWT token string

    Returns:
        User ID string, or empty string if parsing fails
    """
    try:
        import base64
        parts = jwt_token.split(".")
        if len(parts) != 3:
            return ""
        padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
        payload = json.loads(base64.b64decode(padded).decode("utf-8"))
        return payload.get("user", {}).get("id", "")
    except Exception:
        return ""
