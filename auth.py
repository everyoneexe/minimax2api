"""API key extraction and validation for incoming requests."""
import hmac

from fastapi import Header, HTTPException

from config import config_manager


def extract_api_key(
    authorization: str = Header(None),
    x_api_key: str = Header(None, alias="x-api-key"),
) -> str:
    """Extract proxy API key. If proxy_api_keys is empty, auth is disabled."""
    keys = config_manager.config.proxy_api_keys
    if not keys:
        return ""  # Auth disabled

    key = None
    if authorization:
        auth = authorization.strip()
        if auth.lower().startswith("bearer "):
            key = auth[7:].strip()
        else:
            key = auth
    elif x_api_key:
        key = x_api_key.strip()

    if not key:
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "Missing API key.", "type": "authentication_error"}}
        )

    # Constant-time comparison against all keys — no early break to prevent timing attacks
    valid = False
    for k in keys:
        try:
            if hmac.compare_digest(key, str(k)):
                valid = True
        except TypeError:
            pass
    if not valid:
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "Invalid API key.", "type": "authentication_error"}}
        )

    return key
