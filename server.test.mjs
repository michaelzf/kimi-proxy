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
