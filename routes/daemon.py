"""Daemon management routes."""
import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import config_manager
from routes.state import (
    _DAEMON_LOG, _DAEMON_SCRIPT, _LAZY_SERVER_SCRIPT,
    _generator_jobs, daemon_running,
)
import routes.state as _state

router = APIRouter()


class DaemonStartRequest(BaseModel):
    pool_size: int = 15
    max_accounts: int = 0
    browser_count: int = 0
    tabs_per_browser: int = Field(5, ge=1, le=20)


class AddToDaemonRequest(BaseModel):
    emails: list[str]


def _pool_status() -> dict:
    pool_file = Path(__file__).parent.parent / "pool_sessions.json"
    if not pool_file.exists():
        return {"valid": 0, "total": 0}
    try:
        pool = json.loads(pool_file.read_text())
        sessions = pool.get("sessions", [])
        now = time.time()
        valid = []
        by_account: dict = {}
        for s in sessions:
            try:
                exp = datetime.fromisoformat(s["expires_at"].replace("Z", "+00:00"))
                if exp.timestamp() > now:
                    valid.append(s)
                    email = s.get("account_email", "unknown")
                    by_account.setdefault(email, 0)
                    by_account[email] += 1
            except Exception:
                pass
        return {"valid": len(valid), "total": len(sessions), "by_account": by_account}
    except Exception:
        return {"valid": 0, "total": 0, "by_account": {}}


@router.post("/api/daemon/start")
async def daemon_start(req: DaemonStartRequest):
    if daemon_running():
        return JSONResponse({"status": "already_running"})

    _DAEMON_LOG.parent.mkdir(parents=True, exist_ok=True)
    log_f = open(str(_DAEMON_LOG), "a")
    lazy = config_manager.config.lazy_session

    if lazy:
        env = {**os.environ, "LAZY_PORT": "5005", "TABS_PER_BROWSER": str(req.tabs_per_browser)}
        if req.browser_count > 0:
            env["MAX_BROWSERS"] = str(req.browser_count)
        _state._lazy_server_proc = subprocess.Popen(
            ["node", str(_LAZY_SERVER_SCRIPT)],
            cwd=str(_LAZY_SERVER_SCRIPT.parent),
            env=env,
            stdout=log_f,
            stderr=log_f,
        )
        log_f.close()
        _state._daemon_proc = _state._lazy_server_proc
        return JSONResponse({"status": "started", "pid": _state._daemon_proc.pid, "mode": "lazy"})
    else:
        if not _DAEMON_SCRIPT.exists():
            return JSONResponse({"status": "error", "error": f"Daemon script not found: {_DAEMON_SCRIPT}"}, status_code=404)
        env = {**os.environ, "POOL_SIZE": str(req.pool_size), "MAX_ACCOUNTS": str(req.max_accounts)}
        _state._daemon_proc = subprocess.Popen(
            ["node", str(_DAEMON_SCRIPT)],
            cwd=str(_DAEMON_SCRIPT.parent),
            env=env,
            stdout=log_f,
            stderr=log_f,
        )
        log_f.close()
        return JSONResponse({"status": "started", "pid": _state._daemon_proc.pid, "pool_size": req.pool_size, "mode": "pool"})


@router.post("/api/daemon/stop")
async def daemon_stop():
    if not daemon_running():
        for pattern in ["session_daemon.js", "lazy_server.js"]:
            try:
                result = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
                for p in result.stdout.strip().split():
                    try:
                        subprocess.run(["kill", str(int(p))])
                    except (ValueError, Exception):
                        pass
            except Exception:
                pass
        return JSONResponse({"status": "not_running"})

    pid = 0
    if _state._daemon_proc is not None and _state._daemon_proc.poll() is None:
        pid = _state._daemon_proc.pid
        _state._daemon_proc.terminate()
        try:
            _state._daemon_proc.wait(timeout=5)
        except Exception:
            _state._daemon_proc.kill()
        _state._daemon_proc = None
    else:
        try:
            for pattern in ["session_daemon.js", "lazy_server.js"]:
                result = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
                pids = [int(p) for p in result.stdout.strip().split() if p]
                if pids and not pid:
                    pid = pids[0]
                for p in pids:
                    subprocess.run(["kill", str(p)])
        except Exception as e:
            return JSONResponse({"status": "error", "error": str(e)}, status_code=500)

    try:
        subprocess.run(["pkill", "-f", "chrome.*--no-sandbox"], capture_output=True)
    except Exception:
        pass
    try:
        subprocess.run(["pkill", "-f", "chrome-linux64/chrome"], capture_output=True)
    except Exception:
        pass

    return JSONResponse({"status": "stopped", "pid": pid})


@router.get("/api/daemon/status")
async def daemon_status():
    cfg_accounts = config_manager.get_accounts()
    pool = _pool_status()
    by_account = pool.get("by_account", {})
    account_details = [
        {
            "email": a.email,
            "in_daemon": a.is_active and not a.depleted,
            "sessions": by_account.get(a.email, 0),
        }
        for a in cfg_accounts
    ]

    ram_info = {"daemon_mb": 0, "chromium_total_mb": 0, "chromium_procs": 0, "system_used_pct": 0}
    try:
        import psutil
        daemon_pid = None
        if _state._daemon_proc is not None and _state._daemon_proc.poll() is None:
            daemon_pid = _state._daemon_proc.pid
        else:
            try:
                r = subprocess.run(["pgrep", "-f", "session_daemon.js"], capture_output=True, text=True)
                pids = [int(p) for p in r.stdout.strip().split() if p]
                if pids:
                    daemon_pid = pids[0]
            except Exception:
                pass

        if daemon_pid:
            try:
                dp = psutil.Process(daemon_pid)
                daemon_tree = [dp] + dp.children(recursive=True)
                ram_info["daemon_mb"] = round(sum(p.memory_info().rss for p in daemon_tree) / 1024 / 1024, 1)
                chrom_procs = [p for p in daemon_tree if "chrom" in p.name().lower()]
                ram_info["chromium_procs"] = len(chrom_procs)
                ram_info["chromium_total_mb"] = round(sum(p.memory_info().rss for p in chrom_procs) / 1024 / 1024, 1)
                ram_info["chromium_avg_mb"] = round(ram_info["chromium_total_mb"] / len(chrom_procs), 1) if chrom_procs else 0
            except Exception:
                pass
        vm = psutil.virtual_memory()
        ram_info["system_used_pct"] = round(vm.percent, 1)
        ram_info["system_used_mb"] = round(vm.used / 1024 / 1024, 1)
        ram_info["system_total_mb"] = round(vm.total / 1024 / 1024, 1)
    except ImportError:
        pass

    if ram_info.get("chromium_procs", 0) > 0 and pool["valid"] > 0:
        est_per_session = round(ram_info["chromium_total_mb"] / pool["valid"], 1)
    else:
        est_per_session = 120
    ram_info["estimated_mb_per_session"] = est_per_session

    running = daemon_running()
    pid = _state._daemon_proc.pid if (_state._daemon_proc is not None and _state._daemon_proc.poll() is None) else None
    if pid is None and running:
        try:
            result = subprocess.run(["pgrep", "-f", "session_daemon.js"], capture_output=True, text=True)
            pids = [int(p) for p in result.stdout.strip().split() if p]
            if pids:
                pid = pids[-1]
        except Exception:
            pass

    return JSONResponse({
        "running": running,
        "pid": pid,
        "pool": {"valid": pool["valid"], "total": pool["total"]},
        "accounts": account_details,
        "ram": ram_info,
    })


@router.get("/api/daemon/logs")
async def daemon_logs(lines: int = 100):
    if not _DAEMON_LOG.exists():
        return JSONResponse({"lines": []})
    try:
        text = _DAEMON_LOG.read_text(errors="replace")
        all_lines = text.splitlines()[-lines:]
        return JSONResponse({"lines": all_lines})
    except Exception as e:
        return JSONResponse({"lines": [], "error": str(e)})


@router.post("/api/accounts/add-to-daemon")
async def add_to_daemon(req: AddToDaemonRequest):
    found = []
    for job in _generator_jobs.values():
        for acc in job.accounts:
            if acc["email"] in req.emails and acc.get("status") == "success":
                found.append({
                    "email": acc["email"],
                    "password": acc.get("password", ""),
                    "jwtToken": acc.get("jwtToken", ""),
                })

    if not found:
        return JSONResponse({"detail": "Account not found"}, status_code=404)

    from config import Account as _Account
    cfg_accounts = config_manager.get_accounts()
    existing_names = {a.name for a in cfg_accounts}
    existing_emails = {a.email for a in cfg_accounts}
    added = []
    reactivated = []

    for acc in found:
        email = acc["email"]
        name = email.split("@")[0]

        # Check if account already exists
        existing_acc = next((a for a in cfg_accounts if a.email == email), None)

        if existing_acc:
            # Account exists - check if it's disabled/depleted
            if not existing_acc.is_active or existing_acc.depleted or existing_acc.temporarily_no_credits:
                # Reactivate the account with fresh credentials
                existing_acc.password = acc["password"]
                existing_acc.is_active = True
                existing_acc.depleted = False
                existing_acc.temporarily_no_credits = False
                existing_acc.credits_check_after = 0.0
                reactivated.append(email)
            # If active and not depleted, skip (already good)
        elif name not in existing_names:
            # New account - add it
            cfg_accounts.append(_Account(
                name=name,
                email=email,
                password=acc["password"],
                auth_mode="token",
                base_url="https://agent.minimax.io",
                is_active=True,
            ))
            added.append(email)
            existing_emails.add(email)
            existing_names.add(name)

    config_manager.save_accounts(cfg_accounts)

    if daemon_running():
        lazy = config_manager.config.lazy_session
        script = _LAZY_SERVER_SCRIPT if lazy else _DAEMON_SCRIPT
        pool_size = int(os.environ.get("POOL_SIZE", "15"))
        if _state._daemon_proc is not None and _state._daemon_proc.poll() is None:
            _state._daemon_proc.terminate()
            try:
                _state._daemon_proc.wait(timeout=5)
            except Exception:
                _state._daemon_proc.kill()
        else:
            # Externally started — kill via pgrep
            for pattern in ["session_daemon.js", "lazy_server.js"]:
                try:
                    r = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
                    for p in r.stdout.strip().split():
                        if p: subprocess.run(["kill", p])
                except Exception:
                    pass
        log_f = open(str(_DAEMON_LOG), "a")
        if lazy:
            env = {
                **os.environ,
                "LAZY_PORT": os.environ.get("LAZY_PORT", "5005"),
                "TABS_PER_BROWSER": os.environ.get("TABS_PER_BROWSER", "5"),
            }
            if os.environ.get("MAX_BROWSERS"):
                env["MAX_BROWSERS"] = os.environ["MAX_BROWSERS"]
        else:
            env = {**os.environ, "POOL_SIZE": os.environ.get("POOL_SIZE", "15")}
        _state._daemon_proc = subprocess.Popen(
            ["node", str(script)],
            cwd=str(script.parent),
            env=env,
            stdout=log_f,
            stderr=log_f,
        )
        log_f.close()

    return JSONResponse({
        "added": added,
        "reactivated": reactivated,
        "total": len(added) + len(reactivated)
    })
