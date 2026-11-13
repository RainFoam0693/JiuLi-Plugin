import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

/** 官发路由不依赖按钮开关；Markdown 被过滤时维持原输出。 */
export function officialRoute(e, bridge) {
  const adapter = e.bot?.adapter?.name || e.adapter_name
  if (adapter === 'QQBot') return true
  if (!['ICQQ', 'OneBotv11', 'tanebi', 'Secluded'].includes(adapter) || !e.group_id) return false
  try {
    const config = bridge?.config || parse(fs.readFileSync(path.join(process.cwd(), 'plugins/Bili-Plugin/config/config.yaml'), 'utf8'))
    if (config.skipMsgType?.includes('markdown')) return false
    const self = String(config.QQBotid)
    if ((bridge?.bots || globalThis.Bot)?.[self]?.adapter?.name !== 'QQBot') return false
    const bindings = bridge?.bindings || JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/野兽官发/groupBindings.json'), 'utf8'))
    return Object.entries(bindings).some(([key, value]) => key.startsWith(`${self}:`) && String(value) === String(e.group_id))
  } catch { return false }
}

function textNodes(value, depth = 0) {
  if (depth > 5) return null
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    const result = []
    for (const item of value) {
      const nodes = textNodes(item, depth + 1)
      if (!nodes) return null
      result.push(...nodes)
    }
    return result
  }
  if (!value || typeof value !== 'object') return null
  if (value.type === 'reply') return []
  if (value.type === 'node') return textNodes(value.data, depth + 1)
  if (value.message !== undefined) {
    // 单个节点内的相邻文本段先拼回原文。
    const nodes = textNodes(value.message, depth + 1)
    return nodes ? [nodes.join('')] : null
  }
  if (value.type === 'text') return typeof (value.text ?? value.data) === 'string' ? [value.text ?? value.data] : null
  return null
}

const escape = text => text.replace(/([\\`*_{}\[\]()<>#+.!|~])/g, '\\$1')
/** 仅改写纯兑换码结果；混合图片、按钮和其他内容均原样发送。 */
export function rewriteCodeMessage(message) {
  const nodes = textNodes(message)
  if (!nodes?.length) return null
  const blocks = []
  for (const text of nodes) {
    const match = /^兑换码[:：]\s*([A-Za-z0-9_-]{1,128})\r?\n奖励[:：]([^]*?)$/.exec(text.trim())
    if (!match) return null
    blocks.push(`\`\`\`\n${match[1]}\n\`\`\`\n\n奖励：${escape(match[2].trim())}`)
  }
  const content = `## 兑换码\n\n${blocks.join('\n\n---\n\n')}`
  const replies = (Array.isArray(message) ? message : [message]).filter(item => item?.type === 'reply')
  return [...replies, { type: 'markdown', data: { content } }]
}

// Bot 在 Yunzai 中可能是会把未知属性转发给账号的 Proxy；
// 不要用 Symbol 属性访问它，否则不同平台/系统下都会触发隐式字符串转换。
const botStates = new WeakMap()
/** 在适配器发送前处理 node，避免合并转发先被协议编码为 XML。 */
export function installCodeRewrite(bot = globalThis.Bot) {
  if (!bot || (typeof bot !== 'object' && typeof bot !== 'function')) return
  let state = botStates.get(bot)
  if (!state) {
    state = { wrappers: new WeakSet() }
    botStates.set(bot, state)
  }
  state.rewrite = rewriteCodeMessage
  // 让热更新前已挂在野机适配器上的包装器也立即停止改写。
  state.route = e => e.bot?.adapter?.name === 'QQBot'
  const attach = () => {
    for (const adapter of bot.adapter || []) {
      // 仅在真正进入官机适配器时改写，不能按静态群绑定提前改写 ICQQ。
      if (adapter.name !== 'QQBot' || typeof adapter.sendMsg !== 'function' || state.wrappers.has(adapter.sendMsg)) continue
      const original = adapter.sendMsg
      const wrapped = function (...args) {
        const [data, pick, message] = args
        const event = typeof data === 'object' && data !== null
          ? { ...data, bot: { adapter } }
          : { self_id: data, group_id: pick?.group_id, bot: { adapter } }
        const converted = state.rewrite(message)
        if (converted && state.route(event)) args[2] = converted
        return Reflect.apply(original, this, args)
      }
      state.wrappers.add(wrapped)
      adapter.sendMsg = wrapped
    }
  }
  attach()
  if (!state.timer) {
    state.timer = setInterval(attach, 2000)
    state.timer.unref?.()
  }
}
