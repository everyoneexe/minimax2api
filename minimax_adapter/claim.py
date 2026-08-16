"""Daily check-in (credit claim) for MiniMax accounts.

MiniMax grants free daily credits via the signin/claim endpoint. This module
claims those credits for an account using its cached JWT token, reusing the
same request-signing scheme as the rest of the adapter.
"""

import logging

logger = logging.getLogger("minimax2api.adapter.claim")

AGENT_BASE_URL = "https://agent.minimax.io"
CLAIM_PATH = "/minimax-cloud/api/v1/signin/claim"


async def claim_daily(jwt_token: str, user_id: str = "", device_id: str = "62532107",
                      uuid_val: str = "6cafb2f8-5868-4755-a50b-c54f9a7edc4a") -> dict:
    """Perform daily credit claim for an account.

    Args:
        jwt_token: JWT authentication token
        user_id: User ID (derived from token if empty)
        device_id: Device ID
        uuid_val: UUID value

    Returns:
        {
          "success": bool,
          "points": int,        # credits granted today (0 if already claimed)
          "already": bool,      # True if today's claim was already taken
          "raw": dict,          # full upstream response
          "error": str|None,
        }
    """
    from curl_cffi.requests import AsyncSession
    from .utils import unix_timestamp
    from .signing import build_url, build_signed_headers

    if not jwt_token:
        return {"success": False, "points": 0, "already": False, "raw": {}, "error": "no token"}

    # NOTE: the API user_id differs from the JWT's user.id, so it cannot be
    # derived from the token — it must be supplied (stored on the account).
    if not user_id:
        return {"success": False, "points": 0, "already": False, "raw": {}, "error": "no user_id"}
    uid = user_id

    ts_s = unix_timestamp()
    ts_ms = ts_s * 1000
    body = "{}"
    url = f"{AGENT_BASE_URL}{build_url(CLAIM_PATH, jwt_token, uid, device_id, ts_ms, uuid_val)}"
    headers = build_signed_headers(jwt_token, url, body, ts_s)

    try:
        async with AsyncSession(impersonate="firefox") as s:
            # The claim endpoint authenticates via the _token cookie as well
            s.cookies.set("_token", jwt_token, domain=".minimax.io", path="/")
            resp = await s.post(url, data=body, headers=headers, timeout=30)
    except Exception as e:
        return {"success": False, "points": 0, "already": False, "raw": {}, "error": str(e)}

    if resp.status_code != 200:
        return {
            "success": False, "points": 0, "already": False,
            "raw": {}, "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
        }

    try:
        data = resp.json()
    except Exception:
        return {"success": False, "points": 0, "already": False, "raw": {}, "error": f"bad json: {resp.text[:200]}"}

    base = data.get("base_resp", {})
    if base.get("status_code") not in (0, None):
        return {
            "success": False, "points": 0, "already": False,
            "raw": data, "error": base.get("status_msg", "claim failed"),
        }

    payload = data.get("data", {})
    points = int(payload.get("points", 0) or 0)
    # claim_result: 2 = claimed now, 1 = already claimed today (varies by scene)
    claim_result = payload.get("claim_result")
    already = points == 0

    logger.info("Daily claim ok: +%d points (result=%s, already=%s)", points, claim_result, already)
    return {"success": True, "points": points, "already": already, "raw": data, "error": None}
