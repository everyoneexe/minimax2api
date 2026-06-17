# MiniMax2API - 生产级 OpenAI 兼容代理

[English](README.en.md) | 简体中文

高性能、生产就绪的 MiniMax AI OpenAI 兼容 API 代理，支持高级会话管理和智能积分处理。

## ⚠️ 法律声明

**本项目是逆向工程的 Web 界面代理，并非官方 API 客户端。**

- 本工具通过浏览器自动化与 MiniMax Web UI (agent.minimax.io) 交互
- 不使用任何官方 API 密钥或端点
- 仅供教育和研究目的 - 风险自负
- 可能违反 MiniMax 服务条款 - 不提供任何保证或责任
- 与 MiniMax AI 无关联、未获授权或支持
- 用户自行负责遵守 MiniMax 条款和适用法律

**如需官方 API 访问，请直接联系 MiniMax 获取其商业 API 服务。**

## 🎯 特性

### 核心功能
- ✅ **OpenAI 兼容 API** - OpenAI API 的直接替代品
- ✅ **多账户负载均衡** - 跨多个账户分发请求
- ✅ **双模式运行** - Pool 模式（高吞吐）或 Lazy 模式（按需）
- ✅ **工具/函数调用** - 完整支持 OpenAI 函数调用
- ✅ **流式与非流式** - 支持两种响应模式

### 高级会话管理
- ✅ **Pool 模式** - 预认证会话池，25 分钟 TTL 自动刷新
- ✅ **Lazy 模式** - 按需浏览器自动化，持久化标签池
- ✅ **轮询负载均衡** - 跨账户和标签页公平分配
- ✅ **可配置并发** - 根据工作负载扩展浏览器和标签页

### 生产级错误处理
- ✅ **24 小时自动恢复** - 临时积分耗尽自动重试
- ✅ **永久耗尽跟踪** - 标记并跳过配额超限账户
- ✅ **冷却管理** - 过期冷却自动重新加入池
- ✅ **优雅降级** - 瞬态错误处理，无请求失败

### 高吞吐设计
- ✅ **大规模并发** - 5 账户 × 5 标签页 = 25+ 并发请求
- ✅ **公平分配** - 每个账户保持相等的池份额
- ✅ **动态扩展** - 无需重启添加/删除账户
- ✅ **实时监控** - 健康和状态端点

---

## 📦 安装

### 前置要求
- **Python 3.10+**
- **Node.js 18+**
- **Chromium/Chrome**（用于浏览器自动化）

### 快速设置

```bash
# 克隆仓库
git clone <repo-url>
cd minimax2api

# 安装 Python 依赖
pip install -r requirements.txt

# 安装 Node.js 依赖
cd generator
npm install
cd ..

# 配置
cp config.example.json config.json
# 编辑 config.json 填入你的 MiniMax 账户
```

### 🐳 Docker 部署（推荐）

**优势：** 一键启动、依赖隔离、跨平台支持

#### 1. 准备配置

```bash
cp config.example.json config.json
# 编辑 config.json 添加你的 MiniMax 账户
```

#### 2. 启动服务

**Lazy 模式（推荐）：**
```bash
docker-compose --profile lazy up -d
```

**Pool 模式：**
```bash
docker-compose --profile pool up -d
```

**同时运行两种模式：**
```bash
docker-compose --profile lazy --profile pool up -d
```

#### 3. 访问 API

```
http://localhost:8000/v1/chat/completions
http://localhost:8000/health
```

#### 4. 查看日志

```bash
# API 服务器
docker-compose logs -f api

# Lazy server
docker-compose logs -f lazy-server

# Session daemon
docker-compose logs -f session-daemon
```

#### 5. 停止服务

```bash
docker-compose down
```

#### Docker 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `PORT` | API 服务器端口 | 8000 |
| `LAZY_PORT` | Lazy server 端口 | 5005 |
| `MAX_BROWSERS` | 最大浏览器实例数 | 3 |
| `TABS_PER_BROWSER` | 每个浏览器的标签页数 | 5 |
| `POOL_SIZE` | 会话池目标大小 | 20 |
| `MAX_ACCOUNTS` | Pool 模式最大账户数 | 5 |

---

## ⚙️ 配置

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
  "lazy_session": true,
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

### 配置字段

| 字段 | 描述 |
|------|------|
| `proxy_api_keys` | Bearer 认证的 API 密钥 |
| `default_model` | 请求中未指定时的默认模型 |
| `available_models` | 支持的 MiniMax 模型列表 |
| `lazy_session` | `false` = Pool 模式，`true` = Lazy 模式 |
| `accounts` | MiniMax 账户凭据数组 |

### 账户自动管理字段

系统自动设置这些字段：

| 字段 | 描述 |
|------|------|
| `depleted` | 永久配额耗尽（QUOTA_EXCEEDED）|
| `temporarily_no_credits` | 临时积分耗尽（NO_CREDITS）|
| `credits_check_after` | 冷却后重试的时间戳 |

---

## 🚀 使用方法

### 模式 1: Pool 模式（生产推荐）

**适用场景：** 高吞吐、一致延迟、生产部署

**步骤 1: 启动会话守护进程**

```bash
cd generator
POOL_SIZE=20 MAX_ACCOUNTS=5 node session_daemon.js
```

**环境变量：**
- `POOL_SIZE` - 目标总会话数（默认：15）
- `MAX_ACCOUNTS` - 最大账户数，0=无限制（默认：0）
- `HEADLESS` - 无头模式，false 用于调试（默认：true）

**步骤 2: 启动 API 服务器**

```bash
python main.py
```

**发生了什么：**
- 会话守护进程在 `pool_sessions.json` 中创建池
- 公平分配：每个账户保持相等份额
- 25 分钟到期前自动刷新
- 积分耗尽 24 小时冷却
- 监视配置以添加新账户（60 秒间隔）

---

### 模式 2: Lazy 模式（按需）

**适用场景：** 开发、可变负载、内存受限

**步骤 1: 启用 Lazy 模式**

编辑 `config.json`：
```json
{
  "lazy_session": true
}
```

**步骤 2: 启动 Lazy 服务器**

```bash
cd generator
MAX_BROWSERS=5 TABS_PER_BROWSER=5 node lazy_server.js
```

**环境变量：**
- `LAZY_PORT` - 服务器端口（默认：5005）
- `MAX_BROWSERS` - 最大浏览器实例数，0=无限制（默认：0）
- `TABS_PER_BROWSER` - 每个浏览器的标签页数（默认：5）

**步骤 3: 启动 API 服务器**

```bash
python main.py
```

**发生了什么：**
- 浏览器启动并保持登录状态
- 每个浏览器创建标签页池
- 所有标签页轮询分配
- 处理临时/永久积分耗尽
- 从配置自动添加新账户（30 秒间隔）

---

## 📡 API 使用

### 端点

```
POST http://localhost:8000/v1/chat/completions
Authorization: Bearer sk-your-secret-key
Content-Type: application/json
```

### 基本请求

```json
{
  "model": "MiniMax-M2.7",
  "messages": [
    {"role": "user", "content": "你好，最近怎么样？"}
  ]
}
```

### 流式响应

```json
{
  "model": "MiniMax-M2.7",
  "messages": [
    {"role": "user", "content": "给我讲个故事"}
  ],
  "stream": true
}
```

### 工具调用

```json
{
  "model": "MiniMax-M2.7",
  "messages": [
    {"role": "user", "content": "东京的天气怎么样？"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取指定位置的当前天气",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "城市名称"}
          },
          "required": ["location"]
        }
      }
    }
  ]
}
```

### 状态端点

```bash
# API 健康检查
curl http://localhost:8000/api/status

# 账户状态
curl http://localhost:8000/api/accounts

# 会话池状态（Pool 模式）
curl http://localhost:8000/api/pool/status

# Lazy 服务器状态（Lazy 模式）
curl http://localhost:5005/status
```

---

## 🎛️ 性能调优

### 高吞吐设置（25+ 并发请求）

**Pool 模式：**
```bash
POOL_SIZE=30 MAX_ACCOUNTS=5 node session_daemon.js
# 5 账户 × 6 会话 = 30 池会话
# 处理 25+ 并发有余量
```

**Lazy 模式：**
```bash
MAX_BROWSERS=5 TABS_PER_BROWSER=5 node lazy_server.js
# 5 浏览器 × 5 标签页 = 25 并发槽位
```

### 内存使用

**Pool 模式（轻量级）：**
- 会话池：每账户约 1MB RAM
- 无持久化浏览器
- 适合内存受限环境

**Lazy 模式（基于浏览器）：**
- 每浏览器：约 200-300MB
- 每标签页：约 50-100MB
- 示例：5 浏览器 × 5 标签页 ≈ 2-3GB 总计

### 积分耗尽处理

**临时（24 小时冷却）：**
- 触发：浏览器显示"积分不足"
- 操作：账户标记 `temporarily_no_credits`
- 恢复：24 小时后自动重试
- 用例：每日积分限制

**永久耗尽：**
- 触发：API 返回配额超限
- 操作：账户标记 `depleted`，`is_active: false`
- 恢复：永不（需手动干预）
- 用例：试用账户过期

---

## 🛠️ 监控

### 会话池健康检查

```bash
# 查看池文件
cat pool_sessions.json

# 统计有效会话
jq '.sessions | length' pool_sessions.json

# 检查过期时间
jq '.sessions[].expires_at' pool_sessions.json
```

### Lazy 服务器健康检查

```bash
curl http://localhost:5005/status

# 输出：
{
  "tabs_available": 20,
  "tabs_total": 25,
  "accounts": 5,
  "emails": ["acc1@...", "acc2@..."]
}
```

### 账户状态

```bash
curl http://localhost:8000/api/accounts

# 显示每个账户：
# - is_active
# - depleted
# - temporarily_no_credits
# - request_count
# - last_used
```

---

## 🐛 故障排除

### Pool 模式：未创建会话

**检查守护进程日志：**
```bash
cd generator
node session_daemon.js
```

**常见问题：**
- ❌ 凭据错误 → 验证 `config.json`
- ❌ 浏览器崩溃 → 检查 RAM/磁盘空间
- ❌ 超时 → 网络慢或速率限制

### Lazy 模式：标签页未初始化

**检查 lazy 服务器日志：**
```bash
cd generator
HEADLESS=false node lazy_server.js  # 可视化调试
```

**常见问题：**
- ❌ 浏览器无法启动 → 安装 Chromium/Chrome
- ❌ 登录失败 → 验证凭据
- ❌ 端口冲突 → 更改 `LAZY_PORT`

### API："无可用账户"

**检查账户状态：**
```bash
curl http://localhost:8000/api/accounts | jq
```

**可能原因：**
- 所有账户 `depleted: true` → 添加新账户
- 全部在冷却中 → 等待 24 小时或添加账户
- 池为空 → 重启会话守护进程

### 高错误率

**检查 API 日志：**
```bash
python main.py 2>&1 | tee api.log
grep ERROR api.log
```

**错误模式：**
- `TRANSIENT_ERROR` → 网络问题，自动重试
- `NO_CREDITS` → 24 小时冷却活跃
- `QUOTA_EXCEEDED` → 永久耗尽
- `lazy_server error` → Lazy 服务器宕机/过载

---

## 📊 架构

```
┌──────────────┐
│   客户端     │
│  (OpenAI)    │
└──────┬───────┘
       │ HTTP
       ▼
┌─────────────────────────────────┐
│   API 服务器 (main.py)          │
│   - 身份验证                    │
│   - 请求路由                    │
│   - OpenAI 格式处理             │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   代理层 (proxy.py)             │
│   - 账户选择                    │
│   - 负载均衡                    │
│   - 错误处理                    │
│   - 冷却管理                    │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   适配器 (minimax_adapter/)     │
│   - 协议转换                    │
│   - 工具调用转换                │
│   - 会话管理                    │
└──────┬──────────────────────────┘
       │
       ├──────────────┬────────────┐
       ▼              ▼            ▼
┌────────────┐  ┌──────────┐  ┌─────────┐
│ 会话池     │  │  Lazy    │  │ MiniMax │
│           │  │  服务器  │  │   API   │
│(daemon.js)│  │ (标签页) │  │         │
└────────────┘  └──────────┘  └─────────┘
```

---

## 🔒 安全

- ⚠️ **切勿提交 config.json** - 包含明文密码
- 🔑 **定期轮换 API 密钥** - 定期更改 `proxy_api_keys`
- 🔐 **生产环境使用 HTTPS** - 部署在反向代理后（nginx/Caddy）
- 🚦 **添加速率限制** - 考虑对公共端点进行速率限制

---

## 🤝 贡献

欢迎贡献！请：
1. Fork 仓库
2. 创建功能分支
3. 测试 Pool 和 Lazy 模式
4. 提交 Pull Request

---

## 📝 许可证

MIT
