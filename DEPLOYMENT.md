# Production Deployment Guide

## 🚀 Quick Start - Choose Your Deployment Method

### 🐳 Docker Deployment (Recommended for Production)

**Fastest way to get started - all dependencies included!**

```bash
# 1. Prepare configuration
cp config.example.json config.json
# Edit config.json with your MiniMax accounts

# 2. Start services (choose one)
# Lazy mode (memory optimized, 3 browsers)
docker-compose --profile lazy up -d

# Pool mode (high throughput)
docker-compose --profile pool up -d

# 3. Verify
curl http://localhost:8000/health
```

**Benefits:**
- ✅ One-command deployment
- ✅ All dependencies bundled (Python + Node.js + Chrome)
- ✅ Cross-platform (Linux/Mac/Windows)
- ✅ Automatic restart on failure
- ✅ Memory optimized (3 browsers default)

**Jump to:** [Docker Deployment Details](#-docker-deployment-guide)

---

### 💻 Manual Installation

**For development or custom setups**

#### Prerequisites
- [ ] Python 3.10+ installed
- [ ] Node.js 18+ installed
- [ ] Chromium/Chrome browser
- [ ] At least 2 MiniMax accounts with credentials

#### Initial Setup

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

## 🐳 Docker Deployment Guide

### Architecture Overview

Docker deployment uses 3 services:
- **api**: FastAPI server (always running)
- **lazy-server**: Browser automation (optional, profile: `lazy`)
- **session-daemon**: Session pool manager (optional, profile: `pool`)

### Step 1: Prepare Configuration

```bash
cd minimax2api
cp config.example.json config.json
```

Edit `config.json`:
```json
{
  "proxy_api_keys": ["sk-your-secret-key"],
  "default_model": "MiniMax-M3",
  "lazy_session": true,
  "max_concurrent_requests": 100,
  "accounts": [
    {"email": "acc1@example.com", "password": "pass1", "name": "acc-1", "is_active": true},
    {"email": "acc2@example.com", "password": "pass2", "name": "acc-2", "is_active": true}
  ]
}
```

### Step 2: Choose Deployment Mode

#### Option A: Lazy Mode (Recommended)

**Best for:** Memory optimization, development, variable load

```bash
# Start API + Lazy server
docker-compose --profile lazy up -d

# Verify services
docker-compose ps

# Expected output:
# NAME                  STATUS          PORTS
# minimax2api           Up 10 seconds   0.0.0.0:8000->8000/tcp
# minimax2api-lazy      Up 10 seconds   0.0.0.0:5005->5005/tcp
```

**Configuration:**
- `MAX_BROWSERS=3` (default, ~600MB RAM)
- `TABS_PER_BROWSER=5` (15 concurrent slots total)

#### Option B: Pool Mode

**Best for:** High throughput, consistent latency

```bash
# Start API + Session daemon
docker-compose --profile pool up -d

# Verify services
docker-compose ps

# Expected output:
# NAME                  STATUS          PORTS
# minimax2api           Up 10 seconds   0.0.0.0:8000->8000/tcp
# minimax2api-daemon    Up 10 seconds   -
```

**Configuration:**
- `POOL_SIZE=20` (20 pre-authenticated sessions)
- `MAX_ACCOUNTS=5` (use first 5 accounts from config)

#### Option C: Both Modes

```bash
docker-compose --profile lazy --profile pool up -d
```

### Step 3: Verify Deployment

```bash
# Health check
curl http://localhost:8000/health

# Expected:
# {"status":"ok","version":"1.4.0","service":"minimax2api"}

# Test API
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"你好"}]}'
```

### Step 4: Monitor Services

```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f api
docker-compose logs -f lazy-server
docker-compose logs -f session-daemon

# Check resource usage
docker stats minimax2api minimax2api-lazy
```

### Docker Environment Variables

Override in `docker-compose.yml` or via `-e`:

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `PORT` | api | 8000 | API server port |
| `LAZY_PORT` | lazy-server | 5005 | Lazy server port |
| `MAX_BROWSERS` | lazy-server | 3 | Maximum browser instances |
| `TABS_PER_BROWSER` | lazy-server | 5 | Tabs per browser |
| `POOL_SIZE` | session-daemon | 20 | Session pool target size |
| `MAX_ACCOUNTS` | session-daemon | 5 | Max accounts to use |
| `HEADLESS` | session-daemon | true | Headless browser mode |

**Example override:**
```bash
# Increase browsers to 5
MAX_BROWSERS=5 docker-compose --profile lazy up -d

# Or edit docker-compose.yml:
environment:
  - MAX_BROWSERS=5
```

### Production Configuration

#### docker-compose.override.yml (Optional)

Create for production overrides:

```yaml
version: '3.8'

services:
  api:
    restart: always
    environment:
      - PORT=8000
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G

  lazy-server:
    restart: always
    environment:
      - MAX_BROWSERS=5
      - TABS_PER_BROWSER=5
    shm_size: '4gb'
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 6G
```

Apply:
```bash
docker-compose --profile lazy up -d
# Automatically merges docker-compose.override.yml
```

### Maintenance Commands

```bash
# Restart services
docker-compose restart

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Rebuild images (after code changes)
docker-compose build
docker-compose --profile lazy up -d

# View container details
docker inspect minimax2api

# Execute commands inside container
docker exec -it minimax2api bash
docker exec -it minimax2api curl http://localhost:8000/health
```

### Docker Health Checks

#### API Server Health

```bash
# Manual check
docker exec minimax2api curl -f http://localhost:8000/health

# Check from docker-compose
docker-compose ps
# Healthy status shows "(healthy)" next to service name
```

#### Lazy Server Health

```bash
# Check tab availability
docker exec minimax2api-lazy curl http://localhost:5005/status

# Expected:
# {
#   "tabs_available": 12,
#   "tabs_total": 15,
#   "accounts": 3,
#   "emails": ["acc1@...", "acc2@...", "acc3@..."]
# }
```

### Troubleshooting Docker Deployment

#### Issue: Container exits immediately

```bash
# Check logs
docker-compose logs api

# Common causes:
# 1. Missing config.json
docker run -v ./config.json:/app/config.json minimax2api

# 2. Invalid JSON in config.json
docker exec minimax2api python3 -c "import json; json.load(open('config.json'))"

# 3. Port conflict
# Change port in docker-compose.yml or stop conflicting service
```

#### Issue: Chrome crashes in Docker

```bash
# Check shared memory size
docker inspect minimax2api-lazy | grep ShmSize

# Increase if needed (in docker-compose.yml):
lazy-server:
  shm_size: '4gb'  # Increase from 2gb
```

#### Issue: High memory usage

```bash
# Check memory usage
docker stats minimax2api-lazy

# Reduce browsers
MAX_BROWSERS=2 docker-compose --profile lazy up -d

# Or reduce tabs per browser
TABS_PER_BROWSER=3 docker-compose --profile lazy up -d
```

#### Issue: Cannot access API from host

```bash
# Verify port binding
docker-compose ps
# Should show: 0.0.0.0:8000->8000/tcp

# Check firewall
sudo ufw allow 8000/tcp

# Test from inside container
docker exec minimax2api curl http://localhost:8000/health
```

### Docker Production Best Practices

1. **Use docker-compose.override.yml** for environment-specific settings
2. **Set resource limits** to prevent OOM
3. **Configure log rotation** (max-size, max-file)
4. **Use health checks** for auto-restart
5. **Mount config.json as read-only** (`:ro`)
6. **Back up config.json** regularly
7. **Monitor disk space** (logs can grow)
8. **Use named volumes** for pool_sessions.json persistence

### Scaling with Docker

#### Horizontal Scaling (Multiple API Instances)

```yaml
# docker-compose.scale.yml
services:
  api:
    deploy:
      replicas: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - api
```

```bash
docker-compose -f docker-compose.yml -f docker-compose.scale.yml up -d --scale api=3
```

#### nginx.conf (Load Balancer)

```nginx
upstream minimax_backend {
    least_conn;
    server minimax2api_api_1:8000;
    server minimax2api_api_2:8000;
    server minimax2api_api_3:8000;
}

server {
    listen 80;
    location / {
        proxy_pass http://minimax_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 🎯 Production Deployment - Pool Mode (Manual Installation)

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
