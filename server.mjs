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
