# Kimi Coding Plan API 代理服务设计

## 概述

一个轻量 Node.js 代理服务，解决 Kimi Coding Plan API 的 User-Agent 白名单限制。其他后端项目通过此代理访问 Kimi API，无需关心身份伪装细节。

## 架构

```
调用方 (后端服务)
    │
    │  POST http://<proxy-host>:3077/v1/chat/completions
    │  Headers: Authorization: Bearer sk-kimi-xxx
    │  Body: OpenAI 兼容格式
    │
    ▼
┌─────────────────────────────┐
│  kimi-proxy (Node.js)       │
│                             │
│  1. 接收请求                 │
│  2. 注入 User-Agent: KimiCLI/1.3 │
│  3. 过滤空 system message    │
│  4. 转发到 Kimi API          │
│  5. 流式回传 SSE 响应        │
└─────────────────────────────┘
    │
    │  POST https://api.kimi.com/coding/v1/chat/completions
    │  Headers: User-Agent: KimiCLI/1.3
    │
    ▼
  Kimi Coding Plan API
```

## 项目结构

```
kimi/
├── server.mjs          # 服务主文件，约 60 行
├── package.json        # 依赖：仅 express
└── .env.example        # 环境变量示例
```

## 代理行为

### 路由

- `POST /v1/chat/completions` — 主代理路由
- `GET /health` — 健康检查，返回 `{ "ok": true }`

### 请求处理流程

1. **接收请求** — 接受 OpenAI 兼容格式的 body
2. **预处理 body** — 过滤 `messages` 中 `role: "system"` 且 `content` 为空字符串的消息
3. **转发请求** — `fetch("https://api.kimi.com/coding/v1/chat/completions", ...)`
   - 透传调用方的 `Authorization` header
   - 注入 `User-Agent: KimiCLI/1.3`
   - 透传 `Content-Type: application/json`
4. **回传响应**
   - `stream: true` 时：将 Kimi 的 SSE 响应逐块 pipe 回调用方
   - `stream: false` 时：直接返回 JSON 响应

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3077` | 监听端口 |

API Key 不在代理端配置，由调用方在 `Authorization` header 中传入。

## 不做的事

- 不做调用方认证/鉴权
- 不做日志持久化
- 不做限流
- 不做多模型路由
- 不做 API Key 管理

## 调用方接入方式

调用方只需将 base URL 从 `https://api.kimi.com/coding/v1` 改为 `http://<proxy-host>:3077/v1`，其余代码（headers、body）完全不变。

## 注意事项

- `User-Agent: KimiCLI/1.3` 是当前有效的白名单标识，Kimi 可能在未来更新白名单策略，届时需更新此值
- Kimi `kimi-for-coding` 模型的 SSE 流中包含 `delta.reasoning_content`（推理过程）和 `delta.content`（最终回复），代理原样透传，由调用方决定如何使用
