# MiniMax2API - Production-Grade OpenAI-Compatible Proxy

High-performance, production-ready OpenAI-compatible API proxy for MiniMax AI with advanced session management and intelligent credit handling.

## 🎯 Features

### Core Capabilities
- ✅ **OpenAI-Compatible API** - Drop-in replacement for OpenAI API
- ✅ **Multi-Account Load Balancing** - Distribute requests across multiple accounts
- ✅ **Dual Mode Operation** - Pool mode (high-throughput) or Lazy mode (on-demand)
- ✅ **Tool/Function Calling** - Full support for OpenAI function calling
- ✅ **Streaming & Non-Streaming** - Both response modes supported

### Advanced Session Management
- ✅ **Pool Mode** - Pre-authenticated session pool with 25-minute TTL auto-refresh
- ✅ **Lazy Mode** - On-demand browser automation with persistent tab pooling
- ✅ **Round-Robin Load Balancing** - Fair distribution across accounts and tabs
- ✅ **Configurable Concurrency** - Scale browsers and tabs per workload

### Production-Grade Error Handling
- ✅ **24-Hour Auto-Recovery** - Temporary credit exhaustion with automatic retry
- ✅ **Permanent Depletion Tracking** - Flag and skip quota-exceeded accounts
- ✅ **Cooldown Management** - Expired cooldowns automatically rejoin pool
- ✅ **Graceful Degradation** - Transient errors handled without request failures

### High-Throughput Design
- ✅ **Massive Concurrency** - 5 accounts × 5 tabs = 25+ simultaneous requests
- ✅ **Fair Distribution** - Each account maintains equal share of pool
- ✅ **Dynamic Scaling** - Add/remove accounts without restart
- ✅ **Real-Time Monitoring** - Health and status endpoints

---

## 📦 Installation

### Prerequisites
- **Python 3.10+**
- **Node.js 18+**
- **Chromium/Chrome** (for browser automation)

### Quick Setup

```bash
# Clone repository
git clone <repo-url>
cd minimax2api

# Install Python dependencies
pip install -r requirements.txt

# Install Node.js dependencies
cd generator
npm install
cd ..

# Configure
cp config.example.json config.json
# Edit config.json with your MiniMax accounts
```

---

## ⚙️ Configuration

### config.json

```json
{
  "proxy_api_keys": ["sk-your-secret-key"],
  "default_model": "MiniMax-M3",
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
      "password": "password1",
      "name": "account-1",
      "is_active": true
    },
    {
      "email": "account2@example.com",
      "password": "password2",
      "name": "account-2",
      "is_active": true
    }
  ]
}
```

### Configuration Fields

| Field | Description |
|-------|-------------|
| `proxy_api_keys` | API keys for Bearer authentication |
| `default_model` | Default model when not specified in request |
| `available_models` | List of supported MiniMax models |
| `lazy_session` | `false` = Pool mode, `true` = Lazy mode |
| `accounts` | Array of MiniMax account credentials |

### Account Auto-Managed Fields

These fields are automatically set by the system:

| Field | Description |
|-------|-------------|
| `depleted` | Permanently depleted quota (QUOTA_EXCEEDED) |
| `temporarily_no_credits` | Temporary credit exhaustion (NO_CREDITS) |
| `credits_check_after` | Timestamp when to retry after cooldown |

---

## 🚀 Usage

### Mode 1: Pool Mode (Recommended for Production)

**Best for:** High-throughput, consistent latency, production deployments

**Step 1: Start Session Daemon**

```bash
cd generator
POOL_SIZE=20 MAX_ACCOUNTS=5 node session_daemon.js
```

**Environment variables:**
- `POOL_SIZE` - Target total sessions (default: 15)
- `MAX_ACCOUNTS` - Max accounts to use, 0=unlimited (default: 0)
- `HEADLESS` - Headless mode, false for debugging (default: true)

**Step 2: Start API Server**

```bash
python main.py
```

**What happens:**
- Session daemon creates pool in `pool_sessions.json`
- Fair distribution: each account maintains equal share
- Auto-refresh before 25-minute expiry
- 24h cooldown for credit exhaustion
- Watches config for new accounts (60s interval)

---

### Mode 2: Lazy Mode (On-Demand)

**Best for:** Development, variable load, memory constraints

**Step 1: Enable Lazy Mode**

Edit `config.json`:
```json
{
  "lazy_session": true
}
```

**Step 2: Start Lazy Server**

```bash
cd generator
MAX_BROWSERS=5 TABS_PER_BROWSER=5 node lazy_server.js
```

**Environment variables:**
- `LAZY_PORT` - Server port (default: 5005)
- `MAX_BROWSERS` - Max browser instances, 0=unlimited (default: 0)
- `TABS_PER_BROWSER` - Tabs per browser (default: 5)

**Step 3: Start API Server**

```bash
python main.py
```

**What happens:**
- Browsers launch with persistent login state
- Tab pool created per browser
- Round-robin allocation across all tabs
- Temporary/permanent credit exhaustion handled
- New accounts auto-added from config (30s interval)

---

## 📡 API Usage

### Endpoint

```
POST http://localhost:8000/v1/chat/completions
Authorization: Bearer sk-your-secret-key
Content-Type: application/json
```

### Basic Request

```json
{
  "model": "MiniMax-M2.7",
  "messages": [
    {"role": "user", "content": "Hello, how are you?"}
  ]
}
```

### Streaming

```json
{
  "model": "MiniMax-M2.7",
  "messages": [
    {"role": "user", "content": "Tell me a story"}
  ],
  "stream": true
}
```

### Tool Calling

```json
{
  "model": "MiniMax-M2.7",
  "messages": [
    {"role": "user", "content": "What's the weather in Tokyo?"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "City name"}
          },
          "required": ["location"]
        }
      }
    }
  ]
}
```

### Status Endpoints

```bash
# API health
curl http://localhost:8000/api/status

# Account status
curl http://localhost:8000/api/accounts

# Session pool status (Pool mode)
curl http://localhost:8000/api/pool/status

# Lazy server status (Lazy mode)
curl http://localhost:5005/status
```

---

## 🎛️ Performance Tuning

### High-Throughput Setup (25+ Concurrent Requests)

**Pool Mode:**
```bash
POOL_SIZE=30 MAX_ACCOUNTS=5 node session_daemon.js
# 5 accounts × 6 sessions = 30 pool sessions
# Handles 25+ concurrent with headroom
```

**Lazy Mode:**
```bash
MAX_BROWSERS=5 TABS_PER_BROWSER=5 node lazy_server.js
# 5 browsers × 5 tabs = 25 concurrent slots
```

### Memory Usage

**Pool Mode (Lightweight):**
- Session pool: ~1MB RAM per account
- No persistent browsers
- Best for memory-constrained environments

**Lazy Mode (Browser-based):**
- Per browser: ~200-300MB
- Per tab: ~50-100MB
- Example: 5 browsers × 5 tabs ≈ 2-3GB total

### Credit Exhaustion Handling

**Temporary (24h Cooldown):**
- Trigger: Browser shows "not enough Credits"
- Action: Account marked `temporarily_no_credits`
- Recovery: Auto-retries after 24 hours
- Use case: Daily credit limits

**Permanent Depletion:**
- Trigger: API returns quota exceeded
- Action: Account marked `depleted`, `is_active: false`
- Recovery: Never (manual intervention required)
- Use case: Trial accounts expired

---

## 🛠️ Monitoring

### Session Pool Health

```bash
# View pool file
cat pool_sessions.json

# Count valid sessions
jq '.sessions | length' pool_sessions.json

# Check expiry times
jq '.sessions[].expires_at' pool_sessions.json
```

### Lazy Server Health

```bash
curl http://localhost:5005/status

# Output:
{
  "tabs_available": 20,
  "tabs_total": 25,
  "accounts": 5,
  "emails": ["acc1@...", "acc2@..."]
}
```

### Account Status

```bash
curl http://localhost:8000/api/accounts

# Shows per-account:
# - is_active
# - depleted
# - temporarily_no_credits
# - request_count
# - last_used
```

---

## 🐛 Troubleshooting

### Pool Mode: No sessions created

**Check daemon logs:**
```bash
cd generator
node session_daemon.js
```

**Common issues:**
- ❌ Wrong credentials → Verify `config.json`
- ❌ Browser crashes → Check RAM/disk space
- ❌ Timeout → Network slow or rate limited

### Lazy Mode: Tabs not initializing

**Check lazy server logs:**
```bash
cd generator
HEADLESS=false node lazy_server.js  # Visual debugging
```

**Common issues:**
- ❌ Browser won't start → Install Chromium/Chrome
- ❌ Login fails → Verify credentials
- ❌ Port conflict → Change `LAZY_PORT`

### API: "No available accounts"

**Check account status:**
```bash
curl http://localhost:8000/api/accounts | jq
```

**Possible causes:**
- All accounts `depleted: true` → Add new accounts
- All in cooldown → Wait 24h or add accounts
- Pool empty → Restart session daemon

### High Error Rate

**Check API logs:**
```bash
python main.py 2>&1 | tee api.log
grep ERROR api.log
```

**Error patterns:**
- `TRANSIENT_ERROR` → Network issue, auto-retries
- `NO_CREDITS` → 24h cooldown active
- `QUOTA_EXCEEDED` → Permanent depletion
- `lazy_server error` → Lazy server down/overloaded

---

## 📊 Architecture

```
┌──────────────┐
│   Client     │
│  (OpenAI)    │
└──────┬───────┘
       │ HTTP
       ▼
┌─────────────────────────────────┐
│   API Server (main.py)          │
│   - Authentication              │
│   - Request routing             │
│   - OpenAI format handling      │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   Proxy Layer (proxy.py)        │
│   - Account selection           │
│   - Load balancing              │
│   - Error handling              │
│   - Cooldown management         │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   Adapter (minimax_adapter/)    │
│   - Protocol translation        │
│   - Tool call conversion        │
│   - Session management          │
└──────┬──────────────────────────┘
       │
       ├──────────────┬────────────┐
       ▼              ▼            ▼
┌────────────┐  ┌──────────┐  ┌─────────┐
│ Session    │  │  Lazy    │  │ MiniMax │
│ Pool       │  │  Server  │  │   API   │
│ (daemon.js)│  │ (tabs)   │  │         │
└────────────┘  └──────────┘  └─────────┘
```

---

## 🔒 Security

- ⚠️ **Never commit config.json** - Contains plaintext passwords
- 🔑 **Rotate API keys** - Change `proxy_api_keys` regularly
- 🔐 **Use HTTPS in production** - Deploy behind reverse proxy (nginx/Caddy)
- 🚦 **Add rate limiting** - Consider rate limits for public endpoints

---

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Test both Pool and Lazy modes
4. Submit a pull request

---

## 📝 License

MIT
