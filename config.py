"""Configuration management for MiniMax2API proxy.

Sources (priority high → low):
  1. Environment variables
  2. config.json file
  3. Built-in defaults

Enhancements from reference projects:
  - Multi-account support  (MiMo2API, qwen2API)
  - Usage tracking         (MiMo2API)
  - Model name mapping     (all three)
"""

import json
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List


# ── Model name mapping ──────────────────────────────────────────
def resolve_model(client_model: str) -> str:
    """Pass through model name as-is."""
    return client_model


DEFAULT_MODELS = [
    "MiniMax-M3",
    "MiniMax-M3-thinking",
    "MiniMax-M2.7",
    "MiniMax-M2.7-highspeed",
]


# ── Account ─────────────────────────────────────────────────────
@dataclass
class Account:
    name: str = ""
    base_url: str = "https://agent.minimax.io"
    auth_mode: str = "web"
    cookie: str = ""
    is_active: bool = True
    request_count: int = 0
    last_used: float = 0.0
    email: str = ""
    password: str = ""
    depleted: bool = False  # True = credit exhausted permanently, never auto-recover
    temporarily_no_credits: bool = False  # True = temporarily out of credits, retry after credits_check_after
    credits_check_after: float = 0.0  # Timestamp when to retry temporary credit exhaustion (24h cooldown)
    max_concurrent: int = 5  # Max concurrent requests this account can handle (default 5)
    # Note: Runtime concurrency tracking is handled by _account_concurrent dict in proxy.py, not persisted here

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "base_url": self.base_url,
            "auth_mode": self.auth_mode,
            "cookie": self.cookie,
            "is_active": self.is_active,
            "request_count": self.request_count,
            "last_used": self.last_used,
            "email": self.email,
            "password": self.password,
            "depleted": self.depleted,
            "temporarily_no_credits": self.temporarily_no_credits,
            "credits_check_after": self.credits_check_after,
            "max_concurrent": self.max_concurrent,
        }


# ── Usage stats ─────────────────────────────────────────────────
@dataclass
class UsageStats:
    requests: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def to_dict(self) -> dict:
        return {
            "requests": self.requests,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }


# ── Config ──────────────────────────────────────────────────────
@dataclass
class Config:
    proxy_api_keys: List[str] = field(default_factory=lambda: ["sk-default"])
    default_model: str = "MiniMax-M2.7"
    available_models: List[str] = field(default_factory=lambda: DEFAULT_MODELS.copy())
    webui_password: str = "minimax"
    accounts: List[dict] = field(default_factory=list)
    register_proxy: str = ""
    lazy_session: bool = False
    account_pool_target: int = 0  # 0 = disabled, >0 = auto-replenish when active accounts drop below this
    max_concurrent_requests: int = 25  # Global max concurrent requests (distributed across accounts)

    def to_dict(self) -> dict:
        return {
            "proxy_api_keys": list(self.proxy_api_keys),
            "default_model": self.default_model,
            "available_models": list(self.available_models),
            "webui_password": self.webui_password,
            "accounts": [dict(a) for a in self.accounts],  # deep copy — do NOT mutate live config
            "register_proxy": self.register_proxy,
            "lazy_session": self.lazy_session,
            "account_pool_target": self.account_pool_target,
            "max_concurrent_requests": self.max_concurrent_requests,
        }


# ── Usage tracker ───────────────────────────────────────────────
class UsageTracker:
    """Thread-safe in-memory usage stats."""

    def __init__(self):
        self._lock = threading.RLock()
        self._by_key: Dict[str, UsageStats] = {}
        self._by_model: Dict[str, UsageStats] = {}

    def record(self, proxy_key: str, model: str, prompt: int = 0, completion: int = 0):
        with self._lock:
            if proxy_key not in self._by_key:
                self._by_key[proxy_key] = UsageStats()
            if model not in self._by_model:
                self._by_model[model] = UsageStats()
            self._by_key[proxy_key].requests += 1
            self._by_key[proxy_key].prompt_tokens += prompt
            self._by_key[proxy_key].completion_tokens += completion
            self._by_model[model].requests += 1
            self._by_model[model].prompt_tokens += prompt
            self._by_model[model].completion_tokens += completion

    def get_stats(self) -> dict:
        with self._lock:
            total_req = sum(s.requests for s in self._by_key.values())
            total_tok = sum(s.total_tokens for s in self._by_key.values())
            return {
                "total_requests": total_req,
                "total_tokens": total_tok,
                "by_key": {k: v.to_dict() for k, v in self._by_key.items()},
                "by_model": {k: v.to_dict() for k, v in self._by_model.items()},
            }


# ── Config Manager ──────────────────────────────────────────────
class ConfigManager:
    """Thread-safe config backed by JSON + env overrides."""

    def __init__(self, config_file: str = "config.json"):
        # Always resolve relative to this file's directory
        p = Path(config_file)
        if not p.is_absolute():
            p = Path(__file__).parent / config_file
        self.config_file = p
        self.config = Config()
        self._lock = threading.RLock()
        self._load()
        self._apply_env()

    def _load(self):
        if not self.config_file.exists():
            self._save()
            return
        try:
            data = json.loads(self.config_file.read_text("utf-8"))
            # Normalize accounts: ensure new fields exist
            accounts = data.get("accounts", [])
            for acc in accounts:
                acc.setdefault("temporarily_no_credits", False)
                acc.setdefault("credits_check_after", 0.0)
                acc.setdefault("depleted", False)
                acc.setdefault("max_concurrent", 5)  # Default 5 per account

            self.config = Config(
                proxy_api_keys=data.get("proxy_api_keys", ["sk-default"]),
                default_model=data.get("default_model", "MiniMax-M2.7"),
                available_models=data.get("available_models", DEFAULT_MODELS.copy()),
                webui_password=data.get("webui_password", "minimax"),
                accounts=accounts,
                register_proxy=data.get("register_proxy", ""),
                lazy_session=data.get("lazy_session", False),
                account_pool_target=data.get("account_pool_target", 0),
                max_concurrent_requests=data.get("max_concurrent_requests", 25),
            )
        except Exception as exc:
            print(f"[Config] load error: {exc}")
            self.config = Config()
            self._save()

    def _save(self):
        import tempfile
        with self._lock:
            data = json.dumps(self.config.to_dict(), indent=2, ensure_ascii=False)
            tmp = self.config_file.with_suffix(".tmp")
            tmp.write_text(data, "utf-8")
            tmp.replace(self.config_file)

    def _apply_env(self):
        with self._lock:
            if v := os.environ.get("DEFAULT_MODEL", "").strip():
                self.config.default_model = v
            if v := os.environ.get("PROXY_API_KEYS", "").strip():
                self.config.proxy_api_keys = [k.strip() for k in v.split(",") if k.strip()]

    # ── public API ─────────────────────────────────────────────

    def validate_proxy_key(self, key: str) -> bool:
        import hmac as _hmac
        with self._lock:
            keys = self.config.proxy_api_keys
            valid = False
            for k in keys:
                try:
                    if _hmac.compare_digest(key, str(k)):
                        valid = True
                except TypeError:
                    pass
            return valid

    def get_config(self) -> dict:
        with self._lock:
            return self.config.to_dict()

    def update_config(self, new_cfg: dict):
        with self._lock:
            self.config = Config(
                proxy_api_keys=new_cfg.get("proxy_api_keys", self.config.proxy_api_keys),
                default_model=new_cfg.get("default_model", self.config.default_model),
                available_models=new_cfg.get("available_models", self.config.available_models),
                webui_password=new_cfg.get("webui_password", self.config.webui_password),
                accounts=new_cfg.get("accounts", self.config.accounts),
                register_proxy=new_cfg.get("register_proxy", self.config.register_proxy),
                lazy_session=new_cfg.get("lazy_session", self.config.lazy_session),
                account_pool_target=new_cfg.get("account_pool_target", self.config.account_pool_target),
                max_concurrent_requests=new_cfg.get("max_concurrent_requests", self.config.max_concurrent_requests),
            )
            self._save()
            self._apply_env()  # re-apply env overrides after config update

    # ── account helpers ────────────────────────────────────────

    def get_accounts(self) -> List[Account]:
        with self._lock:
            return [Account(**a) for a in self.config.accounts] if self.config.accounts else []

    def save_accounts(self, accounts: List[Account]):
        with self._lock:
            self.config.accounts = [a.to_dict() for a in accounts]
            self._save()

    def update_account(self, acct: Account):
        """Atomically update a single account in config (thread-safe read-modify-write)."""
        import logging as _logging
        with self._lock:
            found = False
            for i, a in enumerate(self.config.accounts):
                if a.get("email") == acct.email or a.get("name") == acct.name:
                    self.config.accounts[i] = acct.to_dict()
                    found = True
                    break
            if not found:
                _logging.getLogger("minimax2api").warning(
                    "update_account: no account found for email=%s name=%s", acct.email, acct.name
                )
            self._save()


# ── Global singletons ───────────────────────────────────────────
config_manager = ConfigManager()
usage_tracker = UsageTracker()


# ── Module-level API ────────────────────────────────────────────
def load_config() -> dict:
    """Load current config as dict."""
    return config_manager.get_config()


def save_config(cfg: dict):
    """Update and save config from dict."""
    config_manager.update_config(cfg)


def get_accounts() -> List[Account]:
    """Get all accounts."""
    return config_manager.get_accounts()


def update_account(acct: Account):
    """Update a single account."""
    config_manager.update_account(acct)
