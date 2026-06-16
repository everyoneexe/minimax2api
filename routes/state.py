"""Shared state and utilities for routes."""
import json
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path

# ── Generator state ──────────────────────────────────────────────

_generator_jobs: dict = {}

_REGISTER_SCRIPT = Path(__file__).parent.parent / "generator" / "register.js"


class GeneratorJob:
    def __init__(self, job_id: str, count: int, parallel: bool = False):
        self.job_id = job_id
        self.count = count
        self.parallel = parallel
        self.done = False
        self.cancelled = False
        self.logs: list = []
        self.accounts: list = []
        self.created_at: float = time.time()
        self._thread: threading.Thread | None = None

    def add_log(self, text: str, level: str = "info"):
        self.logs.append({"ts": int(time.time() * 1000), "text": text, "level": level})

    def to_dict(self):
        return {
            "job_id": self.job_id,
            "done": self.done,
            "cancelled": self.cancelled,
            "logs": list(self.logs),
            "accounts": list(self.accounts),
        }


def _run_generator(job: "GeneratorJob"):
    """Run register.js in a subprocess, stream logs."""
    import json as _json
    from config import config_manager as _cm

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".json")
    os.close(tmp_fd)
    tmp = Path(tmp_path)
    proxy = _cm.config.register_proxy or ""
    env = {**os.environ}
    if proxy:
        env["REGISTER_PROXY_URL"] = proxy
    cmd = [
        "node", "--tls-min-v1.0", "--tls-cipher-list=DEFAULT:@SECLEVEL=0",
        str(_REGISTER_SCRIPT), "--count", str(job.count), "--out", str(tmp),
    ]
    if job.parallel:
        cmd.append("--parallel")

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(_REGISTER_SCRIPT.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
        )
        for line in proc.stdout:
            if job.cancelled:
                proc.terminate()
                job.add_log("Cancelled by user.", "error")
                break
            line = line.rstrip()
            if not line:
                continue
            level = (
                "success" if "✓" in line or "BAŞARILI" in line
                else "error" if "✗" in line or "HATA" in line or "Error" in line
                else "info"
            )
            job.add_log(line, level)
        # proc.wait() with timeout to avoid blocking forever if node ignores SIGTERM
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

        if tmp.exists():
            results = _json.loads(tmp.read_text())
            if not isinstance(results, list):
                results = [results]
            for r in results:
                email = r.get("email", "unknown")
                password = r.get("password", "")
                jwt_token = r.get("jwtToken") or r.get("token") or ""
                if jwt_token and "+" in jwt_token:
                    jwt_token = jwt_token.split("+", 1)[1].strip()
                status = "success" if email and email != "unknown" else "failed"
                job.accounts.append({
                    "email": email,
                    "password": password,
                    "jwtToken": jwt_token,
                    "timestamp": int(time.time()),
                    "status": status,
                })
                if status == "success":
                    job.add_log(
                        f"✓ {email} — token alındı" if jwt_token else f"✓ {email} — token yok",
                        "success" if jwt_token else "error",
                    )

    except FileNotFoundError:
        job.add_log("node bulunamadı. Node.js kurulu mu?", "error")
    except Exception as e:
        job.add_log(f"Hata: {e}", "error")
    finally:
        tmp.unlink(missing_ok=True)
        job.done = True


# ── Daemon state ─────────────────────────────────────────────────

_daemon_proc: subprocess.Popen | None = None
_lazy_server_proc: subprocess.Popen | None = None

_DAEMON_SCRIPT = Path(__file__).parent.parent / "generator" / "session_daemon.js"
_LAZY_SERVER_SCRIPT = Path(__file__).parent.parent / "generator" / "lazy_server.js"
_ACCOUNTS_FILE = Path(__file__).parent.parent.parent / "generator" / "accounts.json"
_DAEMON_LOG = Path("/tmp/daemon.log")


def daemon_running() -> bool:
    global _daemon_proc
    if _daemon_proc is not None and _daemon_proc.poll() is None:
        return True
    try:
        for pattern in ["session_daemon.js", "lazy_server.js"]:
            result = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
            if result.stdout.strip():
                return True
    except Exception:
        pass
    return False


def load_accounts_file() -> list:
    f = Path(_ACCOUNTS_FILE)
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text())
    except Exception:
        return []


def save_accounts_file(accounts: list):
    Path(_ACCOUNTS_FILE).write_text(json.dumps(accounts, indent=2, ensure_ascii=False))
