import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

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

// mock Kimi server 变量
let mockKimi, mockKimiUrl

describe('kimi-proxy', () => {
  after(() => {
    server?.close()
    mockKimi?.close()
  })

  it('GET /health returns ok', async () => {
    await setup()
    const res = await fetch(`${baseUrl}/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body, { ok: true })
  })

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
})
