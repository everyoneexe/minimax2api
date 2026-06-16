"""MiniMax2API — OpenAI-compatible proxy for MiniMax AI.

Routes:
  /v1/chat/completions   OpenAI-compatible chat completions
  /v1/models             Available models
  /admin/…               WebUI management console
  /admin/api/…           Management API (config, usage, accounts)
  /health                Health check
"""

import logging
import os
import uuid
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from config import config_manager
from routes.state import load_accounts_file as _load_accounts_file
from routes.state import GeneratorJob, _generator_jobs, _run_generator
from routes import daemon as _daemon_routes, generator as _generator_routes
from routes import chat as _chat_routes, admin as _admin_routes

# ── logging ─────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("minimax2api")

# ── load .env ───────────────────────────────────────────────────
_env = Path(__file__).parent / ".env"
if _env.exists():
    for line in _env.read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip("\"'")
        if k and not os.environ.get(k):
            os.environ[k] = v

STATIC = Path(__file__).parent / "static"
ADMIN_STATIC = Path(__file__).parent / "admin_static"


# ── lifespan ────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(_app: FastAPI):
    port = int(os.environ.get("PORT", "8000"))
    logger.info("=" * 58)
    logger.info("  MiniMax2API — OpenAI-compatible proxy")
    logger.info("  API   : http://localhost:%d/v1/chat/completions", port)
    logger.info("  Admin : http://localhost:%d/admin/", port)
    logger.info("  Docs  : http://localhost:%d/docs", port)
    logger.info("=" * 58)

    # Sync daemon accounts.json → config on startup
    try:
        from config import Account as _Account
        daemon_accs = _load_accounts_file()
        cfg_accounts = config_manager.get_accounts()
        cfg_names = {a.name for a in cfg_accounts}
        added = 0
        for acc in daemon_accs:
            name = acc.get("email", "").split("@")[0]
            if name and name not in cfg_names:
                cfg_accounts.append(_Account(
                    name=name,
                    auth_mode="token",
                    base_url="https://agent.minimax.io",
                    is_active=True,
                ))
                added += 1
        if added:
            config_manager.save_accounts(cfg_accounts)
            logger.info("Synced %d daemon accounts to config", added)
    except Exception as e:
        logger.warning("Daemon account sync failed: %s", e)

    # Start pool replenishment background task
    import asyncio
    replenish_task = asyncio.create_task(_pool_replenishment_loop())

    yield

    replenish_task.cancel()
    try:
        import asyncio as _asyncio
        await _asyncio.gather(replenish_task, return_exceptions=True)
    except Exception:
        pass


async def _pool_replenishment_loop():
    """Background task: auto-register accounts when pool drops below target."""
    import asyncio
    _replenishment_running = False
    while True:
        try:
            await asyncio.sleep(60)
            if _replenishment_running:
                continue
            target = config_manager.config.account_pool_target
            if target <= 0:
                continue
            accounts = config_manager.get_accounts()
            active = [a for a in accounts if a.is_active and not getattr(a, 'depleted', False)]
            if len(active) >= target:
                continue
            needed = target - len(active)
            logger.info("Pool replenishment: %d active, target %d, registering %d", len(active), target, needed)
            _replenishment_running = True
            # Register new accounts
            job_id = str(uuid.uuid4())
            job = GeneratorJob(job_id, needed, parallel=False)
            _generator_jobs[job_id] = job
            t = threading.Thread(target=_run_generator, args=(job,), daemon=True)
            job._thread = t
            t.start()
            # Wait for job to complete (max 10 min)
            import asyncio as _asyncio
            deadline = _asyncio.get_event_loop().time() + 600
            while not job.done:
                if _asyncio.get_event_loop().time() > deadline:
                    logger.warning("Pool replenishment job %s timed out", job_id)
                    job.cancelled = True
                    break
                await _asyncio.sleep(2)
            if not job.cancelled:
                # Add successful accounts to config
                from config import Account as _Account
                cfg_accounts = config_manager.get_accounts()
                existing_emails = {a.email for a in cfg_accounts}
                for acc in job.accounts:
                    if acc.get('status') == 'success' and acc.get('email') not in existing_emails:
                        name = acc['email'].split('@')[0]
                        cfg_accounts.append(_Account(
                            name=name, email=acc['email'], password=acc.get('password', ''),
                            auth_mode='token', base_url='https://agent.minimax.io', is_active=True,
                        ))
                        logger.info("Pool replenishment: added %s", acc['email'])
                config_manager.save_accounts(cfg_accounts)
            _replenishment_running = False
        except Exception as e:
            _replenishment_running = False
            logger.warning("Pool replenishment error: %s", e)


app = FastAPI(title="MiniMax2API", version="1.4.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])

app.include_router(_daemon_routes.router)
app.include_router(_generator_routes.router)
app.include_router(_chat_routes.router)
app.include_router(_admin_routes.router)

# ── static files ────────────────────────────────────────────────
if STATIC.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
if ADMIN_STATIC.exists():
    app.mount("/admin/static", StaticFiles(directory=str(ADMIN_STATIC)), name="admin_static")


@app.get("/")
async def index():
    idx = STATIC / "index.html"
    if idx.exists():
        return HTMLResponse(idx.read_text("utf-8"))
    return JSONResponse({"error": "WebUI not found"})


@app.get("/admin")
@app.get("/admin/")
async def admin_index():
    idx = ADMIN_STATIC / "index.html"
    if idx.exists():
        return HTMLResponse(idx.read_text("utf-8"))
    return HTMLResponse("<h1>Admin UI not found</h1>", status_code=404)


# ── SPA fallback: let React Router handle unknown paths ─────────

@app.api_route("/{path:path}", methods=["GET"])
async def spa_fallback(path: str):
    if path.startswith(("api/", "v1/", "static/", "admin/", "health")):
        return JSONResponse({"error": "Not found"}, status_code=404)
    idx = STATIC / "index.html"
    if idx.exists():
        return HTMLResponse(idx.read_text("utf-8"))
    return JSONResponse({"error": "WebUI not found"}, status_code=404)


# ── entry point ─────────────────────────────────────────────────
def main():
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="debug")


if __name__ == "__main__":
    main()
