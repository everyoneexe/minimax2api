# MiniMax2API - Production-Grade OpenAI-Compatible Proxy

[简体中文](README.md) | English

High-performance, production-ready OpenAI-compatible API proxy for MiniMax AI. Uses a **token mode** architecture — Puppeteer logs in once to extract a JWT token, then all subsequent requests are pure HTTP with ~50MB RAM usage.

## ⚠️ Legal Disclaimer

**This project is a REVERSE-ENGINEERED web interface proxy, NOT an official API client.**

- Automates interactions with the MiniMax web UI (agent.minimax.io)
- Does NOT use official API keys or endpoints
- Educational and research purposes only — use at your own risk
- May violate MiniMax Terms of Service — no warranty or liability provided
- Not affiliated with, endorsed by, or supported by MiniMax AI
- Users are responsible for compliance with MiniMax's terms and applicable laws

**For official API access, contact MiniMax directly for their commercial API.**

---

## 🎯 Features

- ✅ **OpenAI-Compatible API** — Drop-in replacement (`/v1/chat/completions`)
- ✅ **Token Mode** — Puppeteer runs once per account to extract JWT; all requests are pure HTTP afterward
- ✅ **Multi-Account Load Balancing** — Round-robin with per-account concurrency limits
- ✅ **Auto Token Refresh** — JWT cached in config (~30 day TTL), auto-renewed on expiry
- ✅ **Streaming & Non-Streaming** — Full SSE streaming support
- ✅ **Tool/Function Calling** — Full OpenAI function calling support
- ✅ **Web UI** — Admin dashboard at `/admin/`
- ✅ **24h Credit Cooldown** — Temporary credit exhaustion auto-recovery
- ✅ **Permanent Depletion Tracking** — Skip quota-exceeded accounts automatically

---

## 📦 Installation

### Prerequisites

- **Python 3.10+**
- **Node.js 18+**
- **Chromium/Chrome** (for initial JWT extraction only)

### Quick Setup

```bash
git clone https://github.com/everyoneexe/minimax2api.git
cd minimax2api

# Python dependencies
pip install -r requirements.txt

# Node.js dependencies
cd generator && npm install && cd ..

# Configure accounts
cp config.example.json config.json
# Edit config.json — add email/password for each account
```

### 🐳 Docker

```bash
cp config.example.json config.json
# Edit config.json

docker-compose up -d
```

---

## ⚙️ Configuration

### config.json

```json
{
  "proxy_api_keys": ["sk-your-secret-key"],
  "default_model": "MiniMax-M2.7",
  "available_models": [
    "MiniMax-M3",
    "MiniMax-M3-thinking",
    "MiniMax-M2.7",
    "MiniMax-M2.7-highspeed"
  ],
  "lazy_session": false,
  "accounts": [
    {
      "email": "account1@example.com",
      "password": "yourpassword",
      "name": "account-1",
      "auth_mode": "token",
      "is_active": true
    }
  ]
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `proxy_api_keys` | Bearer auth keys for downstream clients |
| `default_model` | Fallback model when not specified |
| `lazy_session` | `false` = token mode (default), `true` = legacy Puppeteer lazy mode |
| `accounts` | Array of MiniMax account credentials |

### Auto-Managed Account Fields

The system automatically populates these — do not set manually:

| Field | Description |
|-------|-------------|
| `saved_token` | Cached JWT token |
| `token_expires` | JWT expiry timestamp |
| `agent_id` | Per-account MiniMax agent ID |
| `user_id` | MiniMax user ID |
| `saved_cookies` | Session cookies cached alongside the token |
| `depleted` | Permanently quota-exceeded |
| `temporarily_no_credits` | 24h credit cooldown active |

---

## 🚀 Usage

### Start the API server

```bash
python main.py
```

That's it. On first request per account, Puppeteer logs in once, extracts the JWT token + cookies + agent_id, and caches them in `config.json`. All subsequent requests for that account are pure HTTP — no browser needed.

**Admin UI:** `http://localhost:8000/admin/`
**API endpoint:** `http://localhost:8000/v1/chat/completions`

---

## 📡 API

### Chat Completion

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

### Streaming

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

### Available Models

| Model | Description |
|-------|-------------|
| `MiniMax-M2.7` | Default — fast, capable |
| `MiniMax-M2.7-highspeed` | Faster variant |
| `MiniMax-M3` | Latest, no thinking |
| `MiniMax-M3-thinking` | Latest with chain-of-thought |

---

## 📊 Architecture

```
Client (OpenAI SDK / curl)
         │
         ▼
  API Server (main.py)
  FastAPI, port 8000
         │
         ▼
  Proxy Layer (proxy.py)
  account selection, load balancing,
  credit cooldown management
         │
         ▼
  _get_creds(account)
  ┌─────────────────────────────┐
  │ saved_token valid?          │
  │  yes → use cached JWT       │
  │  no  → run extract_jwt.js   │
  │        (Puppeteer, ~30s)    │
  │        cache result         │
  └─────────────────────────────┘
         │
         ▼
  minimax_adapter/
  ├── session.py   POST /archon/api/v1/agent/{agent_id}/session
  └── session.py   POST /archon/api/v1/session/{session_id}/message (SSE)
         │
         ▼
  agent.minimax.io / agent-stream.minimax.io
```

**Token lifecycle:**
1. First use: Puppeteer logs in, sends "hi", captures JWT from session request headers
2. JWT + cookies + agent_id saved to `config.json`
3. All subsequent requests: pure HTTP, no browser
4. JWT expires (~30 days): auto-refresh via Puppeteer on next request

---

## 🛠️ Monitoring

```bash
# Health
curl http://localhost:8000/health

# Account status
curl -H "Authorization: Bearer sk-your-key" http://localhost:8000/api/accounts/status

# Usage stats
curl -H "Authorization: Bearer sk-your-key" http://localhost:8000/api/usage
```

---

## 🐛 Troubleshooting

**"Token extraction failed"**
- Check email/password in config.json
- Ensure Chromium is installed: `which chromium`
- Check Node.js deps: `cd generator && npm install`

**"No available accounts"**
- All accounts depleted or in cooldown
- Add fresh accounts to config.json

**JWT extraction timeout**
- Network slow — increase timeout in `http_login.py` (`extract_jwt(..., timeout=120)`)
- Try running manually: `node generator/extract_jwt.js email@example.com password`

**401 on session creation**
- Token expired — delete `saved_token` and `token_expires` from the account in config.json to force refresh

---

## 🔒 Security

- ⚠️ **Never commit config.json** — contains plaintext passwords and JWT tokens
- 🔑 **Rotate proxy_api_keys** regularly
- 🔐 **Use HTTPS in production** — deploy behind nginx/Caddy

---

## 📝 License

AGPL-3.0 — See [LICENSE](LICENSE) for details.
