# MiniMax2API - 生产级 OpenAI 兼容代理

[English](README.en.md) | 简体中文

高性能、生产就绪的 MiniMax AI OpenAI 兼容 API 代理。采用 **Token 模式**架构 — Puppeteer 仅在首次使用时登录提取 JWT Token，之后所有请求均为纯 HTTP，内存占用约 50MB。

## ⚠️ 法律声明

**本项目是逆向工程的 Web 界面代理，并非官方 API 客户端。**

- 通过浏览器自动化与 MiniMax Web UI (agent.minimax.io) 交互
- 不使用任何官方 API 密钥或端点
- 仅供教育和研究目的 — 风险自负
- 可能违反 MiniMax 服务条款 — 不提供任何保证或责任
- 与 MiniMax AI 无关联、未获授权或支持
- 用户自行负责遵守 MiniMax 条款和适用法律

**如需官方 API 访问，请直接联系 MiniMax 获取商业 API 服务。**

---

## 🎯 特性

- ✅ **OpenAI 兼容 API** — 完全替代 OpenAI API (`/v1/chat/completions`)
- ✅ **Token 模式** — Puppeteer 每账户仅运行一次提取 JWT，之后全部纯 HTTP
- ✅ **多账户负载均衡** — 轮询分配，支持每账户并发限制
- ✅ **自动 Token 刷新** — JWT 缓存至 config.json（约 30 天有效），过期自动续期
- ✅ **流式与非流式** — 完整 SSE 流式支持
- ✅ **工具/函数调用** — 完整支持 OpenAI 函数调用
- ✅ **Web 管理界面** — 管理面板位于 `/admin/`
- ✅ **24 小时积分冷却** — 临时积分耗尽自动恢复
- ✅ **永久耗尽追踪** — 自动跳过配额超限账户

---

## 📦 安装

### 前置要求

- **Python 3.10+**
- **Node.js 18+**
- **Chromium/Chrome**（仅用于首次 JWT 提取）

### 快速设置

```bash
git clone https://github.com/everyoneexe/minimax2api.git
cd minimax2api

# Python 依赖
pip install -r requirements.txt

# Node.js 依赖
cd generator && npm install && cd ..

# 配置账户
cp config.example.json config.json
# 编辑 config.json，填入账户邮箱和密码
```

### 🐳 Docker

```bash
cp config.example.json config.json
# 编辑 config.json

docker-compose up -d
```

---

## ⚙️ 配置

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

### 主要配置字段

| 字段 | 说明 |
|------|------|
| `proxy_api_keys` | 下游客户端 Bearer 认证密钥 |
| `default_model` | 请求未指定时的默认模型 |
| `lazy_session` | `false` = Token 模式（默认），`true` = 旧版 Lazy 模式 |
| `accounts` | MiniMax 账户凭据数组 |

### 系统自动管理的账户字段

这些字段由系统自动写入，无需手动设置：

| 字段 | 说明 |
|------|------|
| `saved_token` | 缓存的 JWT Token |
| `token_expires` | JWT 过期时间戳 |
| `agent_id` | 每账户专属的 MiniMax agent ID |
| `user_id` | MiniMax 用户 ID |
| `saved_cookies` | 与 Token 一同缓存的会话 Cookie |
| `depleted` | 永久配额耗尽 |
| `temporarily_no_credits` | 24 小时积分冷却中 |

---

## 🚀 使用方法

### 启动 API 服务器

```bash
python main.py
```

仅此一步。首次请求时，系统自动通过 Puppeteer 登录账户、提取 JWT Token + Cookie + agent_id 并缓存至 `config.json`。后续所有请求均为纯 HTTP，无需浏览器。

**管理面板：** `http://localhost:8000/admin/`  
**API 端点：** `http://localhost:8000/v1/chat/completions`

---

## 📡 API 使用

### 对话补全

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [{"role": "user", "content": "你好！"}],
    "stream": false
  }'
```

### 流式响应

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [{"role": "user", "content": "给我讲个故事"}],
    "stream": true
  }'
```

### 可用模型

| 模型 | 说明 |
|------|------|
| `MiniMax-M2.7` | 默认 — 快速、能力强 |
| `MiniMax-M2.7-highspeed` | 更快变体 |
| `MiniMax-M3` | 最新版，无思考模式 |
| `MiniMax-M3-thinking` | 最新版，带思维链 |

---

## 📊 架构

```
客户端（OpenAI SDK / curl）
         │
         ▼
  API 服务器 (main.py)
  FastAPI，端口 8000
         │
         ▼
  代理层 (proxy.py)
  账户选择、负载均衡、积分冷却管理
         │
         ▼
  _get_creds(账户)
  ┌──────────────────────────────┐
  │ saved_token 有效？           │
  │  是 → 使用缓存 JWT           │
  │  否 → 运行 extract_jwt.js    │
  │        (Puppeteer，约 30 秒) │
  │        缓存结果              │
  └──────────────────────────────┘
         │
         ▼
  minimax_adapter/
  ├── session.py   POST /archon/api/v1/agent/{agent_id}/session
  └── session.py   POST /archon/api/v1/session/{session_id}/message (SSE)
         │
         ▼
  agent.minimax.io / agent-stream.minimax.io
```

**Token 生命周期：**
1. 首次使用：Puppeteer 登录，发送 "hi"，从 session 请求头中提取 JWT
2. JWT + Cookie + agent_id 保存至 `config.json`
3. 后续请求：纯 HTTP，无需浏览器
4. JWT 过期（约 30 天）：下次请求时自动通过 Puppeteer 刷新

---

## 🛠️ 监控

```bash
# 健康检查
curl http://localhost:8000/health

# 账户状态
curl -H "Authorization: Bearer sk-your-key" http://localhost:8000/api/accounts/status

# 使用统计
curl -H "Authorization: Bearer sk-your-key" http://localhost:8000/api/usage
```

---

## 🐛 故障排查

**"Token extraction failed"（Token 提取失败）**
- 检查 config.json 中的邮箱和密码
- 确认 Chromium 已安装：`which chromium`
- 检查 Node.js 依赖：`cd generator && npm install`
- 手动测试：`node generator/extract_jwt.js email@example.com password`

**"No available accounts"（无可用账户）**
- 所有账户已耗尽或处于冷却中
- 向 config.json 添加新账户

**JWT 提取超时**
- 网络较慢 — 在 `http_login.py` 中增大超时：`extract_jwt(..., timeout=120)`

**Session 创建 401**
- Token 已过期 — 在 config.json 对应账户中删除 `saved_token` 和 `token_expires` 字段，强制刷新

---

## 🔒 安全

- ⚠️ **切勿提交 config.json** — 包含明文密码和 JWT Token
- 🔑 **定期轮换 proxy_api_keys**
- 🔐 **生产环境使用 HTTPS** — 部署在 nginx/Caddy 反向代理后

---

## 📝 许可证

AGPL-3.0 — 详见 [LICENSE](LICENSE) 文件。
