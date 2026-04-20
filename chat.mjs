#!/usr/bin/env node

import readline from 'node:readline'

const BASE_URL = process.env.KIMI_BASE_URL || 'http://localhost:3077/v1'
const API_KEY = process.env.KIMI_API_KEY
const MODEL = process.env.KIMI_MODEL || 'kimi-for-coding'

if (!API_KEY) {
  console.error('请设置环境变量 KIMI_API_KEY，例如：')
  console.error('  KIMI_API_KEY=sk-kimi-xxx node chat.mjs')
  process.exit(1)
}

const messages = []

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.on('close', () => process.exit(0))

console.log(`kimi-chat (model: ${MODEL}, base: ${BASE_URL})`)
console.log('输入消息开始对话，输入 /quit 退出，/clear 清空上下文\n')

function prompt() {
  rl.question('> ', async (input) => {
    const trimmed = input.trim()
    if (!trimmed) return prompt()
    if (trimmed === '/quit') return rl.close()
    if (trimmed === '/clear') {
      messages.length = 0
      console.log('[上下文已清空]\n')
      return prompt()
    }

    messages.push({ role: 'user', content: trimmed })

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({ model: MODEL, stream: true, messages })
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
        console.error(`\n[错误 ${res.status}] ${err.error?.message}\n`)
        messages.pop()
        return prompt()
      }

      process.stdout.write('\n')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistant = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices?.[0]?.delta?.content || ''
            if (content) {
              process.stdout.write(content)
              assistant += content
            }
          } catch {}
        }
      }

      process.stdout.write('\n\n')
      if (assistant) {
        messages.push({ role: 'assistant', content: assistant })
      }
    } catch (err) {
      console.error(`\n[连接错误] ${err.message}\n`)
      messages.pop()
    }

    prompt()
  })
}

prompt()
