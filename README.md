# MiniMax2API

OpenAI-compatible API proxy for MiniMax AI with automatic account management.

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- Anthropic Claude API compatibility
- Image generation support
- Multi-account load balancing with health scoring
- Session pool management with auto-refresh
- Web dashboard for monitoring and configuration
- Automatic account registration via Puppeteer

## Quick Start

```bash
# 1. Install Python dependencies
cd minimax2api
pip install -r requirements.txt

# 2. Install Node.js dependencies (for account generator)
cd ../generator
npm install

# 3. Configure
cd ../minimax2api
cp config.example.json config.json
# Edit config.json with your settings

# 4. Run the server
python3 main.py
```

Server runs on `http://localhost:8000`
- API: `http://localhost:8000/v1/chat/completions`
- Dashboard: `http://localhost:8000/admin/`

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
PORT=8000
WEBUI_PASSWORD=your_password
PROXY_API_KEYS=sk-minimax
REGISTER_PROXY_URL=http://user:pass@proxy.host:port  # Optional
```

### Account Registration

For automatic account generation, set a proxy:

```bash
export REGISTER_PROXY_URL="http://username:password@proxy.host:port"
cd generator
node register.js --count 5
```

## API Usage

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-minimax" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

## Project Structure

```
minimax2api/
├── minimax2api/          # Backend API server
│   ├── main.py           # FastAPI application
│   ├── proxy.py          # Request routing logic
│   ├── config.py         # Configuration management
│   ├── minimax_adapter/  # MiniMax API client
│   └── routes/           # API endpoints
├── generator/            # Account registration tools
│   ├── register.js       # Account creator
│   ├── lazy_server.js    # Browser pool server
│   └── session_daemon.js # Session pool manager
└── frontend/             # React dashboard (built to minimax2api/static/)
```

## License

MIT
