#!/usr/bin/env node

import readline from 'node:readline'
import { readFileSync } from 'node:fs'

// 读取 .env 文件（如果存在）
try {
  const envContent = readFileSync('.env', 'utf8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2]
    }
  }
} catch {}

const BASE_URL = process.env.KIMI_BASE_URL || 'http://localhost:3077/v1'
const API_KEY = process.env.KIMI_API_KEY
const MODEL = process.env.KIMI_MODEL || 'kimi-for-coding'
// 直连模式：跳过代理，直接连 Kimi API（需要注入 User-Agent）
const DIRECT = BASE_URL.includes('kimi.com')

if (!API_KEY) {
  console.error('错误：未设置 KIMI_API_KEY')
  console.error('方式 1：创建 .env 文件写入 KIMI_API_KEY=sk-kimi-xxx')
  console.error('方式 2：KIMI_API_KEY=sk-kimi-xxx node chat.mjs')
  console.error('可选环境变量：')
  console.error('  KIMI_BASE_URL  API 地址（默认 http://localhost:3077/v1）')
  console.error('                 设为 https://api.kimi.com/coding/v1 可直连跳过代理')
  console.error('  KIMI_MODEL     模型名称（默认 kimi-for-coding）')
  process.exit(1)
}

const DIM = '\x1b[90m'
const RESET = '\x1b[0m'

const messages = []
let abortController = null
let isRequesting = false

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.on('close', () => process.exit(0))

// Ctrl+C: 请求中则中断请求，否则退出
process.on('SIGINT', () => {
  if (isRequesting && abortController) {
    abortController.abort()
  } else {
    console.log('\n再见！')
    process.exit(0)
  }
})

console.log(`kimi-chat (model: ${MODEL}, base: ${BASE_URL})`)
console.log('命令：/quit 退出，/clear 清空上下文')
console.log(`多行输入：输入内容后空行回车发送，Ctrl+C 中断当前请求\n`)

function readMultiline() {
  return new Promise((resolve, reject) => {
    const lines = []
    let firstLine = true

    function askLine() {
      const prefix = firstLine ? '> ' : '.. '
      rl.question(prefix, (input) => {
        firstLine = false
        // 空行 + 已有内容 = 结束输入
        if (input.trim() === '' && lines.length > 0) {
          resolve(lines.join('\n').trim())
        } else if (input.trim() === '' && lines.length === 0) {
          // 空行 + 无内容 = 跳过
          resolve('')
        } else {
          lines.push(input)
          askLine()
        }
      })
    }

    rl.once('close', () => resolve(''))
    askLine()
  })
}

async function chat(input) {
  messages.push({ role: 'user', content: input })
  abortController = new AbortController()
  isRequesting = true

  process.stdout.write(`${DIM}思考中...${RESET}`)

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    }
    if (DIRECT) headers['User-Agent'] = 'KimiCLI/1.3'

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: MODEL, stream: true, messages }),
      signal: abortController.signal
    })

    // 清除"思考中..."，显示角色标识
    process.stdout.write('\r\x1b[K')
    process.stdout.write(`\n\x1b[32m◀ kimi\x1b[0m\n`)

    if (!res.ok) {
      let errMsg = res.statusText
      try {
        const err = await res.json()
        errMsg = err.error?.message || errMsg
      } catch {}
      console.error(`[错误 ${res.status}] ${errMsg}\n`)
      messages.pop()
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let assistant = ''
    let reasoning = ''
    let buffer = ''
    let inReasoning = false
    let firstToken = true

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trimStart()
          if (data === '[DONE]') continue

          let parsed
          try {
            parsed = JSON.parse(data)
          } catch {
            continue
          }

          const delta = parsed.choices?.[0]?.delta
          if (!delta) continue

          // 处理推理内容（灰色展示）
          const rc = delta.reasoning_content || ''
          if (rc) {
            if (!inReasoning) {
              inReasoning = true
              process.stdout.write(`${DIM}[思考] `)
            }
            process.stdout.write(rc)
            reasoning += rc
          }

          // 处理正式回复
          const content = delta.content || ''
          if (content) {
            if (inReasoning) {
              inReasoning = false
              process.stdout.write(`${RESET}\n\n`)
            }
            if (firstToken) {
              firstToken = false
            }
            process.stdout.write(content)
            assistant += content
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        process.stdout.write(`${RESET}\n[已中断]\n\n`)
        // 中断时移除未完成的 user message
        messages.pop()
        return
      }
      throw err
    }

    // 结束推理颜色
    if (inReasoning) {
      process.stdout.write(`${RESET}\n`)
    }

    if (assistant) {
      process.stdout.write('\n\n')
      messages.push({ role: 'assistant', content: assistant })
    } else {
      process.stdout.write(`${DIM}[空回复]${RESET}\n\n`)
      messages.pop()
    }
  } catch (err) {
    // 清除"思考中..."（如果还在）
    process.stdout.write('\r\x1b[K')

    if (err.name === 'AbortError') {
      console.log('[已中断]\n')
      messages.pop()
      return
    }

    if (err.code === 'ECONNREFUSED') {
      console.error(`[连接失败] 无法连接到 ${BASE_URL}，请确认代理服务已启动\n`)
    } else if (err.code === 'ENOTFOUND') {
      console.error(`[DNS错误] 无法解析 ${BASE_URL}，请检查地址是否正确\n`)
    } else if (err.code === 'ETIMEDOUT' || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
      console.error(`[超时] 连接 ${BASE_URL} 超时，请检查网络\n`)
    } else {
      console.error(`[错误] ${err.message}\n`)
    }
    messages.pop()
  } finally {
    isRequesting = false
    abortController = null
  }
}

async function main() {
  while (true) {
    const input = await readMultiline()
    if (!input) continue

    if (input === '/quit') {
      console.log('再见！')
      process.exit(0)
    }
    if (input === '/clear') {
      messages.length = 0
      console.log('[上下文已清空]\n')
      continue
    }

    await chat(input)
  }
}

main()
