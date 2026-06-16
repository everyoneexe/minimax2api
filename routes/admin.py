"""Admin / management API routes."""
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from auth import extract_api_key
from config import config_manager, usage_tracker
from proxy import test_connection, test_account_by_index, get_accounts_status, fetch_models

router = APIRouter()

_admin = Depends(extract_api_key)


class LoginRequest(BaseModel):
    password: str


@router.post("/api/auth/login")
async def webui_login(req: LoginRequest):
    expected = config_manager.config.webui_password or ""
    if expected and hmac.compare_digest(req.password, expected):
        return {"success": True}
    return JSONResponse({"success": False, "error": "Invalid password"}, status_code=401)


@router.get("/api/config")
async def get_config():
    cfg = config_manager.get_config()
    if "accounts" in cfg:
        for a in cfg["accounts"]:
            if "password" in a:
                a["password"] = "***"
            if "cookie" in a:
                a["cookie"] = "***"
    return JSONResponse(cfg)


@router.post("/api/config")
async def update_config(req: Request):
    try:
        data = await req.json()
        config_manager.update_config(data)
        return JSONResponse({"status": "ok"})
    except Exception as e:
        return JSONResponse({"status": "error", "error": str(e)}, status_code=400)


@router.post("/api/test", dependencies=[_admin])
async def test_api():
    return JSONResponse(await test_connection())


@router.post("/api/test-account/{idx:int}", dependencies=[_admin])
async def test_account_route(idx: int):
    accounts = config_manager.get_accounts()
    if idx < 0 or idx >= len(accounts):
        raise HTTPException(status_code=404, detail="Account index out of range")
    return JSONResponse(await test_account_by_index(idx))


@router.get("/api/accounts/status", dependencies=[_admin])
async def accounts_status():
    return JSONResponse(get_accounts_status())


@router.get("/api/models")
async def api_models():
    return JSONResponse(await fetch_models())


@router.get("/api/usage", dependencies=[_admin])
async def get_usage():
    return JSONResponse(usage_tracker.get_stats())


@router.get("/health")
async def health():
    return {"status": "ok", "version": "1.4.0", "service": "minimax2api"}
