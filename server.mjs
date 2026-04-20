import express from 'express'

const app = express()

app.get('/health', (req, res) => {
  res.json({ ok: true })
})

app.use(express.json({ limit: '50mb' }))

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
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
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
