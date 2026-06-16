"""HTTP signing and URL building for MiniMax API."""

from urllib.parse import urlparse, quote
from .utils import md5

# MiniMax API secret key for signing
SECRET = "I*7Cf%WZ#S&%1RlZJ&C2"

# Default query parameters for MiniMax requests
FAKE_PARAMS = {
    "device_platform": "web",
    "biz_id": "3",
    "app_id": "3001",
    "version_code": "22201",
    "unix": "",
    "timezone_offset": "10800",
    "sys_language": "en",
    "lang": "en",
    "uuid": "6cafb2f8-5868-4755-a50b-c54f9a7edc4a",
    "device_id": "62532107",
    "os_name": "Linux",
    "browser_name": "Firefox",
    "cpu_core_num": "16",
    "browser_language": "en-US",
    "browser_platform": "Linux+x86_64",
    "user_id": "",
    "screen_width": "1920",
    "screen_height": "1080",
    "token": "",
    "client": "web",
    "region": "en",
}

# Default headers for MiniMax requests
FAKE_HEADERS = {
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0",
    "Referer": "https://agent.minimax.io/",
    "Origin": "https://agent.minimax.io",
}


def build_signed_headers(
    jwt_token: str,
    url: str,
    body_str: str,
    ts_s: int,
) -> dict:
    """Build signed headers matching the MiniMax JS implementation.

    Args:
        jwt_token: JWT authentication token
        url: Full request URL
        body_str: Request body as JSON string
        ts_s: Unix timestamp in seconds

    Returns:
        Dictionary of HTTP headers with signatures

    Signature algorithm:
        x-signature = MD5(ts_s + SECRET + body_str)
        yy = MD5(quote(path_and_query, safe="~()*!'") + "_" + yy_body + MD5(ts_ms_str) + "ooui")

    Where:
        ts_ms = ts_s * 1000  (milliseconds)
        yy_body = body_str if POST else "{}"
    """
    ts_ms = ts_s * 1000

    # Parse and extract path and query to preserve exact formatting
    parsed = urlparse(url)
    path_and_query = parsed.path + ("?" + parsed.query if parsed.query else "")

    # yy body: use body_str for POST, "{}" for GET
    yy_body = body_str if body_str else "{}"

    # JS encodeURIComponent equivalent
    encoded_path = quote(path_and_query, safe="~()*!'")
    ts_ms_md5 = md5(str(ts_ms))
    yy = md5(f"{encoded_path}_{yy_body}{ts_ms_md5}ooui")

    # x-signature
    sig = md5(f"{ts_s}{SECRET}{body_str}")

    return {
        **FAKE_HEADERS,
        "Content-Type": "application/json",
        "token": jwt_token,
        "x-timestamp": str(ts_s),
        "x-signature": sig,
        "yy": yy,
    }


def build_url(
    path: str,
    jwt_token: str,
    user_id: str,
    device_id: str,
    ts_ms: int,
    uuid_val: str = ""
) -> str:
    """Build full URL with query params matching browser's URLSearchParams order.

    Args:
        path: API path (e.g., "/archon/api/v1/agent/123/session")
        jwt_token: JWT authentication token
        user_id: User ID
        device_id: Device ID
        ts_ms: Unix timestamp in milliseconds
        uuid_val: Optional UUID override

    Returns:
        Full URL with query string
    """
    params = dict(FAKE_PARAMS)
    params["unix"] = str(ts_ms)
    params["device_id"] = device_id
    params["user_id"] = user_id or "0"
    params["token"] = jwt_token
    if uuid_val:
        params["uuid"] = uuid_val

    # Build query string (skip empty values)
    parts = []
    for k, v in params.items():
        if v == "":
            continue
        parts.append(f"{k}={v}")

    qs = "&".join(parts)
    return f"{path}?{qs}"
