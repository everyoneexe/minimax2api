# Production Deployment Guide

## 🚀 Quick Start Checklist

### Prerequisites
- [ ] Python 3.10+ installed
- [ ] Node.js 18+ installed
- [ ] Chromium/Chrome browser
- [ ] At least 2 MiniMax accounts with credentials

### Initial Setup

```bash
# 1. Clone and install dependencies
cd minimax2api
pip install -r requirements.txt
cd generator && npm install && cd ..

# 2. Configure accounts
cp config.example.json config.json
# Edit config.json with your accounts

# 3. Choose mode (Pool or Lazy)
```

---

## 🎯 Production Deployment - Pool Mode (Recommended)

**Best for:** High throughput, consistent latency, 24/7 operation

### Step 1: Configure Pool Mode

Edit `config.json`:
```json
{
  "lazy_session": false,
  "accounts": [
    {"email": "acc1@example.com", "password": "pass1", "name": "acc-1", "is_active": true},
    {"email": "acc2@example.com", "password": "pass2", "name": "acc-2", "is_active": true}
  ]
}
```

### Step 2: Start Session Daemon

```bash
cd generator

# For 5 accounts, 20 sessions total
POOL_SIZE=20 MAX_ACCOUNTS=5 HEADLESS=true node session_daemon.js

# Output should show:
# ✅ account1@... added to pool (6 tabs)
# ✅ account2@... added to pool (6 tabs)
# ...
```

**Verify pool created:**
```bash
cat pool_sessions.json | jq '.sessions | length'
# Should show: 20
```

### Step 3: Start API Server

```bash
# In main directory
python main.py

# Output:
# INFO:     Started server process
# INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Step 4: Test API

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer sk-minimax-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [{"role": "user", "content": "Hello"}]
  }' | jq
```

**Expected output:**
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "MiniMax-M2.7",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 8,
    "completion_tokens": 12,
    "total_tokens": 20
  }
}
```

---

## 🎯 Production Deployment - Lazy Mode

**Best for:** Development, variable load, on-demand scaling

### Step 1: Configure Lazy Mode

Edit `config.json`:
```json
{
  "lazy_session": true,
  "accounts": [
    {"email": "acc1@example.com", "password": "pass1", "name": "acc-1", "is_active": true},
    {"email": "acc2@example.com", "password": "pass2", "name": "acc-2", "is_active": true}
  ]
}
```

### Step 2: Start Lazy Server

```bash
cd generator

# For 5 browsers, 5 tabs each = 25 concurrent slots
MAX_BROWSERS=5 TABS_PER_BROWSER=5 LAZY_PORT=5005 node lazy_server.js

# Output should show:
# [account1@...] ✅ Browser ready with 5 tabs
# [account2@...] ✅ Browser ready with 5 tabs
# ...
```

**Verify status:**
```bash
curl http://localhost:5005/status | jq
# Should show:
# {
#   "tabs_available": 25,
#   "tabs_total": 25,
#   "accounts": 5,
#   "emails": [...]
# }
```

### Step 3: Start API Server

```bash
# In main directory
python main.py
```

### Step 4: Test API

Same as Pool mode test above.

---

## 🎛️ Performance Tuning

### High-Concurrency Setup (25+ Requests/10s)

**Pool Mode:**
```bash
# 5 accounts × 6 sessions = 30 total sessions
POOL_SIZE=30 MAX_ACCOUNTS=5 node session_daemon.js
```

**Lazy Mode:**
```bash
# 5 browsers × 5 tabs = 25 concurrent slots
MAX_BROWSERS=5 TABS_PER_BROWSER=5 node lazy_server.js
```

### Memory Optimization

**Pool Mode:**
- RAM usage: ~500MB for daemon + 1GB for Python API
- Total: ~1.5GB

**Lazy Mode:**
- RAM usage per browser: ~250MB
- RAM usage per tab: ~75MB
- 5 browsers × 5 tabs: ~3-4GB total
- Python API: ~1GB
- Total: ~4-5GB

### Resource Limits

**System requirements for 25 concurrent requests:**
- CPU: 4+ cores
- RAM: 4-6GB (Lazy mode), 2GB (Pool mode)
- Disk: 1GB free for logs/cache
- Network: Stable connection to agent.minimax.io

---

## 🛡️ Error Handling Verification

### Test Temporary Credit Exhaustion

1. Use account until "not enough Credits" appears
2. Check config.json:
```bash
cat config.json | jq '.accounts[] | select(.email=="test@example.com") | {temporarily_no_credits, credits_check_after}'
```

**Expected:**
```json
{
  "temporarily_no_credits": true,
  "credits_check_after": 1718543400000
}
```

3. Account should auto-recover after 24h

### Test Permanent Depletion

When API returns quota exceeded:
```bash
cat config.json | jq '.accounts[] | select(.email=="test@example.com") | {depleted, is_active}'
```

**Expected:**
```json
{
  "depleted": true,
  "is_active": false
}
```

Account won't be used again (manual intervention required).

---

## 📊 Monitoring Commands

### Pool Mode Health Check

```bash
# Session count
cat pool_sessions.json | jq '.sessions | length'

# Sessions by account
cat pool_sessions.json | jq '.sessions | group_by(.account_email) | map({account: .[0].account_email, count: length})'

# Expiry times
cat pool_sessions.json | jq '.sessions[] | {email: .account_email, expires: .expires_at}'
```

### Lazy Mode Health Check

```bash
# Server status
curl http://localhost:5005/status | jq

# Expected healthy output:
# {
#   "tabs_available": 20-25,
#   "tabs_total": 25,
#   "accounts": 5
# }
```

### API Health Check

```bash
# Overall status
curl http://localhost:8000/api/status | jq

# Account status
curl http://localhost:8000/api/accounts | jq

# Look for:
# - is_active: true
# - depleted: false
# - temporarily_no_credits: false
```

---

## 🔧 Systemd Service (Linux Production)

### Pool Mode Service

Create `/etc/systemd/system/minimax-daemon.service`:
```ini
[Unit]
Description=MiniMax Session Pool Daemon
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/minimax2api/generator
Environment="POOL_SIZE=30"
Environment="MAX_ACCOUNTS=5"
Environment="HEADLESS=true"
ExecStart=/usr/bin/node session_daemon.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/minimax-api.service`:
```ini
[Unit]
Description=MiniMax API Server
After=network.target minimax-daemon.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/minimax2api
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable minimax-daemon minimax-api
sudo systemctl start minimax-daemon minimax-api

# Check status
sudo systemctl status minimax-daemon
sudo systemctl status minimax-api
```

### Lazy Mode Service

Create `/etc/systemd/system/minimax-lazy.service`:
```ini
[Unit]
Description=MiniMax Lazy Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/minimax2api/generator
Environment="MAX_BROWSERS=5"
Environment="TABS_PER_BROWSER=5"
Environment="LAZY_PORT=5005"
ExecStart=/usr/bin/node lazy_server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Update `minimax-api.service` After line:
```ini
After=network.target minimax-lazy.service
```

---

## 🐛 Common Issues

### Issue: "No available accounts"

**Cause:** All accounts depleted or in cooldown

**Solution:**
```bash
# Check account status
cat config.json | jq '.accounts[] | {email, is_active, depleted, temporarily_no_credits}'

# Add new accounts to config.json
# Restart services
```

### Issue: Pool daemon crashes

**Check logs:**
```bash
# If running with systemd
sudo journalctl -u minimax-daemon -f

# Common causes:
# - Out of memory → Reduce POOL_SIZE
# - Login failure → Verify credentials
# - Rate limit → Reduce session creation rate
```

### Issue: Lazy server tabs stuck at 0

**Debug:**
```bash
# Run in foreground with visual mode
cd generator
HEADLESS=false node lazy_server.js

# Watch for:
# - Login success
# - Tab initialization
# - Any browser errors
```

### Issue: High latency

**Pool Mode:**
- Check session pool freshness: `cat pool_sessions.json | jq '.sessions[].created_at'`
- Sessions older than 20min may be slower
- Restart daemon to refresh

**Lazy Mode:**
- Check tabs_available: `curl localhost:5005/status`
- If tabs_available < 5, increase TABS_PER_BROWSER
- Consider switching to Pool mode for better latency

---

## 📈 Scaling Guide

### Horizontal Scaling (Multiple Instances)

**Pool Mode:**
1. Deploy multiple API servers with shared `pool_sessions.json` (NFS/shared storage)
2. Single session daemon instance
3. Load balancer (nginx) in front of API servers

**Lazy Mode:**
1. Deploy multiple API + lazy server pairs
2. Each instance manages its own browsers
3. Load balancer distributes requests

### Vertical Scaling (More Capacity)

**Pool Mode:**
- Increase POOL_SIZE: +5 sessions per account
- Add more accounts
- Run multiple daemon instances with different accounts

**Lazy Mode:**
- Increase TABS_PER_BROWSER: 5 → 10
- Increase MAX_BROWSERS: 5 → 10
- Monitor RAM usage

---

## ✅ Production Readiness Checklist

- [ ] Config files secured (not in git, proper permissions)
- [ ] Both modes tested and working
- [ ] Error handling verified (temporary + permanent depletion)
- [ ] Monitoring endpoints accessible
- [ ] Systemd services configured (if Linux)
- [ ] Logs configured and rotating
- [ ] Backups configured for config.json
- [ ] Health checks automated
- [ ] Alerting configured (e.g., all accounts depleted)
- [ ] Documentation updated for team
- [ ] Load testing completed (25+ concurrent requests)
- [ ] HTTPS/reverse proxy configured (production)

---

## 📞 Support

For production issues:
1. Check logs: `journalctl` or `python main.py 2>&1 | tee api.log`
2. Verify account status: `curl localhost:8000/api/accounts`
3. Check pool/lazy health: status endpoints
4. Review this guide's troubleshooting section
