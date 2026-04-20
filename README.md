# kimi-proxy

Kimi Coding Plan API 代理服务。解决 Kimi Coding Plan API 的 User-Agent 白名单限制，其他项目通过此代理即可正常调用 Kimi API。

## 原理

Kimi Coding Plan API 会校验请求头中的 User-Agent，只允许白名单内的编程工具（如 Kimi CLI、Claude Code 等）访问。本代理自动注入 `User-Agent: KimiCLI/1.3`，调用方无需关心身份校验。

## 快速开始

```bash
git clone https://github.com/michaelzf/kimi-proxy.git
cd kimi-proxy
npm install
npm start
# kimi-proxy listening on port 3077
```

自定义端口：

```bash
PORT=8080 npm start
```

## 使用方式

代理兼容 OpenAI API 格式。调用方只需将 base URL 改为代理地址，其余不变。

### 非流式请求

```bash
curl -X POST http://localhost:3077/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-kimi-你的key" \
  -d '{
    "model": "kimi-for-coding",
    "stream": false,
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

### 流式请求 (SSE)

```bash
curl -X POST http://localhost:3077/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-kimi-你的key" \
  -d '{
    "model": "kimi-for-coding",
    "stream": true,
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

### 多模态（图片）

支持 base64 编码的图片：

```bash
B64=$(base64 -i your-image.jpg)

curl -X POST http://localhost:3077/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-kimi-你的key" \
  -d "{
    \"model\": \"kimi-for-coding\",
    \"stream\": false,
    \"messages\": [{\"role\": \"user\", \"content\": [
      {\"type\": \"image_url\", \"image_url\": {\"url\": \"data:image/jpeg;base64,${B64}\"}},
      {\"type\": \"text\", \"text\": \"这张图片里是什么?\"}
    ]}]
  }"
```

> 注意：Kimi Coding Plan API 不支持直接传 PDF，需先转为图片。

### 健康检查

```bash
curl http://localhost:3077/health
# {"ok":true}
```

## 在项目中集成

调用方只需将 base URL 从 Kimi 官方地址改为代理地址：

```
# 原来
https://api.kimi.com/coding/v1

# 改为
http://<代理地址>:3077/v1
```

API Key 由调用方自己在 `Authorization` header 中传入，代理不存储任何密钥。

### Node.js 示例

```js
const res = await fetch('http://localhost:3077/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-kimi-你的key'
  },
  body: JSON.stringify({
    model: 'kimi-for-coding',
    stream: false,
    messages: [{ role: 'user', content: 'hello' }]
  })
})
```

### Python 示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-kimi-你的key",
    base_url="http://localhost:3077/v1"
)

response = client.chat.completions.create(
    model="kimi-for-coding",
    messages=[{"role": "user", "content": "hello"}]
)
```

## 部署

```bash
# 使用 pm2
pm2 start server.mjs --name kimi-proxy

# 或 nohup
nohup node server.mjs &
```

## 代理行为

- 注入 `User-Agent: KimiCLI/1.3` 通过 Kimi 白名单校验
- 过滤空的 system message（避免 Kimi 返回 400 错误）
- 透传 Authorization header（API Key 由调用方提供）
- 透传上游错误响应（状态码和错误信息原样返回）
- 不做认证、限流、日志持久化
