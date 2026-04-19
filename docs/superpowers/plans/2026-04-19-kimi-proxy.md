# Kimi Proxy 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Node.js 代理服务，注入 User-Agent 头后将请求透传到 Kimi Coding Plan API，支持流式和非流式响应。

**Architecture:** 单文件 Express 服务。接收 OpenAI 兼容格式请求，过滤空 system message，注入 `User-Agent: KimiCLI/1.3`，用 `fetch` 转发到 `https://api.kimi.com/coding/v1/chat/completions`，流式时 pipe SSE 响应回调用方。

**Tech Stack:** Node.js (ESM), Express

---

## 文件结构

```
kimi/
├── server.mjs              # 代理服务主文件
├── server.test.mjs         # 测试文件
├── package.json            # 项目配置与依赖
├── .env.example            # 环境变量示例
└── docs/superpowers/       # 设计与计划文档
```

---

### Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `.env.example`

- [ ] **Step 1: 初始化 package.json**

```bash
cd /Users/zhaofeng/Work/kimi
npm init -y
```

然后手动编辑 `package.json`，设置如下内容：

```json
{
  "name": "kimi-proxy",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.mjs",
    "test": "node --test server.test.mjs"
  },
  "dependencies": {
    "express": "^4.21.0"
  }
}
```

- [ ] **Step 2: 创建 .env.example**

```
PORT=3077
```

- [ ] **Step 3: 安装依赖**

```bash
npm install
```

Expected: `node_modules` 目录创建，`package-lock.json` 生成。

- [ ] **Step 4: 创建 .gitignore**

```
node_modules/
.env
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore
git commit -m "chore: init project with express dependency"
```

---

### Task 2: Health 端点 (TDD)

**Files:**
- Create: `server.mjs`
- Create: `server.test.mjs`

- [ ] **Step 1: 写 health 端点的失败测试**

创建 `server.test.mjs`：

```js
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'

// 动态 import server 并启动在随机端口
let server, baseUrl

async function setup() {
  const { app } = await import('./server.mjs')
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port
      baseUrl = `http://localhost:${port}`
      resolve()
    })
  })
}

describe('kimi-proxy', () => {
  after(() => server?.close())

  it('GET /health returns ok', async () => {
    await setup()
    const res = await fetch(`${baseUrl}/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body, { ok: true })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test
```

Expected: FAIL — `server.mjs` 不存在。

- [ ] **Step 3: 实现 server.mjs 的 health 端点**

创建 `server.mjs`：

```js
import express from 'express'

const app = express()

app.get('/health', (req, res) => {
  res.json({ ok: true })
})

// 仅在直接运行时监听端口（非测试导入）
const isDirectRun = process.argv[1]?.endsWith('server.mjs')
if (isDirectRun) {
  const port = process.env.PORT || 3077
  app.listen(port, () => {
    console.log(`kimi-proxy listening on port ${port}`)
  })
}

export { app }
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm test
```

Expected: PASS — `GET /health returns ok`

- [ ] **Step 5: Commit**

```bash
git add server.mjs server.test.mjs
git commit -m "feat: add health endpoint with test"
```

---

### Task 3: 非流式代理转发 (TDD)

**Files:**
- Modify: `server.mjs`
- Modify: `server.test.mjs`

- [ ] **Step 1: 写非流式代理的失败测试**

在 `server.test.mjs` 的 `describe` 块中添加测试。此测试用一个本地 mock server 模拟 Kimi API：

```js
import http from 'node:http'

// 在 describe 块顶部添加 mock server 变量
let mockKimi, mockKimiUrl

// 在 after 回调中添加 mockKimi?.close()

it('POST /v1/chat/completions proxies non-streaming request', async () => {
  // 启动 mock Kimi server
  mockKimi = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const parsed = JSON.parse(body)
      // 验证 User-Agent 被注入
      assert.equal(req.headers['user-agent'], 'KimiCLI/1.3')
      // 验证 Authorization 被透传
      assert.equal(req.headers['authorization'], 'Bearer sk-test-key')
      // 验证空 system message 被过滤
      const hasEmptySystem = parsed.messages.some(
        (m) => m.role === 'system' && m.content === ''
      )
      assert.equal(hasEmptySystem, false)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-123',
        choices: [{ message: { role: 'assistant', content: 'hello' } }]
      }))
    })
  })

  await new Promise((resolve) => {
    mockKimi.listen(0, () => {
      mockKimiUrl = `http://localhost:${mockKimi.address().port}`
      resolve()
    })
  })

  // 设置环境变量指向 mock server
  process.env.KIMI_API_URL = `${mockKimiUrl}/v1/chat/completions`

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-test-key'
    },
    body: JSON.stringify({
      model: 'kimi-for-coding',
      stream: false,
      messages: [
        { role: 'system', content: '' },
        { role: 'user', content: 'hi' }
      ]
    })
  })

  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.choices[0].message.content, 'hello')
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test
```

Expected: FAIL — `/v1/chat/completions` 路由不存在，返回 404。

- [ ] **Step 3: 实现非流式代理路由**

在 `server.mjs` 中 `app.get('/health', ...)` 之后添加：

```js
app.use(express.json())

const KIMI_DEFAULT_URL = 'https://api.kimi.com/coding/v1/chat/completions'

app.post('/v1/chat/completions', async (req, res) => {
  const targetUrl = process.env.KIMI_API_URL || KIMI_DEFAULT_URL

  // 过滤空 system message
  const body = { ...req.body }
  if (Array.isArray(body.messages)) {
    body.messages = body.messages.filter(
      (m) => !(m.role === 'system' && (!m.content || m.content.trim() === ''))
    )
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers['authorization'] || '',
        'User-Agent': 'KimiCLI/1.3'
      },
      body: JSON.stringify(body)
    })

    if (!body.stream) {
      const data = await upstream.json()
      res.status(upstream.status).json(data)
      return
    }

    // 流式处理在 Task 4 实现
    res.status(501).json({ error: 'streaming not yet implemented' })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm test
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add server.mjs server.test.mjs
git commit -m "feat: add non-streaming proxy with User-Agent injection and empty system message filtering"
```

---

### Task 4: 流式 (SSE) 代理转发 (TDD)

**Files:**
- Modify: `server.mjs`
- Modify: `server.test.mjs`

- [ ] **Step 1: 写流式代理的失败测试**

在 `server.test.mjs` 的 `describe` 块中添加：

```js
it('POST /v1/chat/completions proxies streaming (SSE) request', async () => {
  // 关闭之前的 mock，启动新的 SSE mock
  mockKimi?.close()

  mockKimi = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      assert.equal(req.headers['user-agent'], 'KimiCLI/1.3')

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      res.write('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n')
      res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })

  await new Promise((resolve) => {
    mockKimi.listen(0, () => {
      mockKimiUrl = `http://localhost:${mockKimi.address().port}`
      resolve()
    })
  })

  process.env.KIMI_API_URL = `${mockKimiUrl}/v1/chat/completions`

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-test-key'
    },
    body: JSON.stringify({
      model: 'kimi-for-coding',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }]
    })
  })

  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/event-stream')

  const text = await res.text()
  assert.ok(text.includes('data: {"choices":[{"delta":{"content":"hel"}}]}'))
  assert.ok(text.includes('data: [DONE]'))
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test
```

Expected: FAIL — 流式请求返回 501。

- [ ] **Step 3: 实现流式转发**

在 `server.mjs` 中，将 `// 流式处理在 Task 4 实现` 那一行及下一行替换为：

```js
    // 流式：透传 SSE
    res.writeHead(upstream.status, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    })

    const reader = upstream.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    } finally {
      res.end()
    }
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm test
```

Expected: 全部 PASS（3 个测试）。

- [ ] **Step 5: Commit**

```bash
git add server.mjs server.test.mjs
git commit -m "feat: add SSE streaming proxy support"
```

---

### Task 5: 错误透传测试

**Files:**
- Modify: `server.test.mjs`

- [ ] **Step 1: 写 upstream 错误透传的测试**

在 `server.test.mjs` 的 `describe` 块中添加：

```js
it('proxies upstream error responses as-is', async () => {
  mockKimi?.close()

  mockKimi = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: { message: 'invalid api key', type: 'auth_error' }
      }))
    })
  })

  await new Promise((resolve) => {
    mockKimi.listen(0, () => {
      mockKimiUrl = `http://localhost:${mockKimi.address().port}`
      resolve()
    })
  })

  process.env.KIMI_API_URL = `${mockKimiUrl}/v1/chat/completions`

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer bad-key'
    },
    body: JSON.stringify({
      model: 'kimi-for-coding',
      stream: false,
      messages: [{ role: 'user', content: 'hi' }]
    })
  })

  assert.equal(res.status, 403)
  const data = await res.json()
  assert.equal(data.error.message, 'invalid api key')
})
```

- [ ] **Step 2: 运行测试，确认通过**

```bash
npm test
```

Expected: 全部 PASS（4 个测试）。这个测试应该直接通过，因为 Task 3 的实现已经用 `upstream.status` 透传了状态码。

- [ ] **Step 3: Commit**

```bash
git add server.test.mjs
git commit -m "test: add upstream error passthrough test"
```

---

### Task 6: 手动冒烟测试（可选，需真实 API Key）

**Files:** 无文件变更

- [ ] **Step 1: 启动代理服务**

```bash
cd /Users/zhaofeng/Work/kimi
npm start
```

Expected: `kimi-proxy listening on port 3077`

- [ ] **Step 2: 在另一个终端用 curl 测试 health**

```bash
curl http://localhost:3077/health
```

Expected: `{"ok":true}`

- [ ] **Step 3: 用 curl 测试非流式请求**

将 `sk-kimi-xxxx` 替换为你的真实 API Key：

```bash
curl -X POST http://localhost:3077/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-kimi-xxxx" \
  -d '{
    "model": "kimi-for-coding",
    "stream": false,
    "messages": [{"role": "user", "content": "说hello"}]
  }'
```

Expected: 返回 JSON，`choices[0].message.content` 包含回复。

- [ ] **Step 4: 用 curl 测试流式请求**

```bash
curl -X POST http://localhost:3077/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-kimi-xxxx" \
  -d '{
    "model": "kimi-for-coding",
    "stream": true,
    "messages": [{"role": "user", "content": "说hello"}]
  }'
```

Expected: 逐行输出 `data: {...}` 格式的 SSE 事件，最后一行为 `data: [DONE]`。
