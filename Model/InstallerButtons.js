import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

const callbacks = new Map()
const TTL = 20 * 60 * 1000
const MAX_CALLBACKS = 1500
const PREFIX = '#JLPM:'

/** 判断实际发送渠道：原生 QQBot 或 Bili 已绑定的野收官发。 */
export function getInstallerRoute(e, bridgeData) {
  const adapter = e?.bot?.adapter?.name || e?.adapter_name
  if (adapter === 'QQBot') return { type: 'official', self: String(e.self_id) }
  if (!['ICQQ', 'OneBotv11', 'tanebi', 'Secluded'].includes(adapter) || !e.group_id) return null
  try {
    // 只读发送路由所需的配置，不加载 Bili 模块，避免触发其初始化和适配器修改。
    const config = bridgeData?.config || parse(fs.readFileSync(path.join(process.cwd(), 'plugins/Bili-Plugin/config/config.yaml'), 'utf8'))
    if (config.sikpbnt || config.skipMsgType?.includes('button')) return null
    const bots = bridgeData?.bots || globalThis.Bot
    const self = String(config.QQBotid)
    if (bots?.[self]?.adapter?.name !== 'QQBot') return null
    const bindings = bridgeData?.bindings || JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/野兽官发/groupBindings.json'), 'utf8'))
    const binding = Object.entries(bindings).find(([key, value]) => key.startsWith(`${self}:`) && String(value) === String(e.group_id))
    if (!binding) return null
    return { type: 'bridge', self, group: binding[0] }
  } catch { return null }
}

export function isOfficialQQBot(e) {
  return Boolean(getInstallerRoute(e))
}

/** 使用 SDK 身份，不把 toQQUin 映射后的数字 QQ 与原生 openid 混用。 */
function callbackOwner(e) {
  const raw = e?.sender?.openid || e?.openid || e?.raw?.operator_id || e?.sender?.raw_user_id
  if (raw) return { id: String(raw), stable: true }
  const id = String(e.user_id)
  const prefix = `${e.self_id}${e?.bot?.adapter?.sep || ':'}`
  return id.startsWith(prefix) ? { id: id.slice(prefix.length), stable: true } : { id, stable: false }
}

function contextKey(e) {
  return JSON.stringify([String(e.self_id), callbackOwner(e).id, String(e.group_id || e.channel_id || e.guild_id || 'private')])
}

/** 腾讯 botgo Modal 约束：正文最多40字符、无URL；按钮文字最多4字符。 */
export function installationModal(name) {
  const prefix = '安装「'
  const suffix = '」？将下载插件并安装依赖。'
  const budget = 40 - prefix.length - suffix.length
  const label = String(name || '此插件')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/\S*)?/gi, '')
    .replace(/[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s*[（(][^（）()]*[）)]\s*$/u, '')
    .replace(/\s+/g, ' ').trim() || '此插件'
  let short = ''
  for (const char of label) {
    if (short.length + char.length > budget - 1) break
    short += char
  }
  if (short !== label) short += '…'
  return { content: `${prefix}${short}${suffix}`, confirm_text: '安装', cancel_text: '取消' }
}

export function callbackButton(e, text, action, options = {}) {
  const route = getInstallerRoute(e)
  if (!route || !e.isMaster) return null
  const now = Date.now()
  for (const [key, value] of callbacks) if (value.expires <= now) callbacks.delete(key)
  while (callbacks.size >= MAX_CALLBACKS) callbacks.delete(callbacks.keys().next().value)
  const token = randomBytes(12).toString('hex')
  callbacks.set(token, { action, stableOwner: callbackOwner(e).stable, authorizedMaster: true, scope: contextKey(e), bridge: route.type === 'bridge' ? route : null, expires: now + TTL })
  const data = `${PREFIX}${token}`
  return {
    text, clicked_text: text, callback: data,
    type: 1,
    // 不将框架 user_id 传给客户端指定用户权限（私聊可能是映射 QQ 号或带前缀 ID）。
    // 客户端允许触发，服务端以按钮创建时已验证的主人 openid 与会话严格校验。
    // 强制原生 interaction 回调，避免 QQBot 的 toCallback=false 将其变为发消息按钮。
    // button_data 由 QQBot 适配器还原为内部回调入口；不会发送聊天指令。
    QQBot: { action: { type: 1, data, enter: false, reply: false } },
    style: options.style ?? 0,
    ...(options.installName ? { modal: installationModal(options.installName) } : {})
  }
}

export function resolveInstallerCallback(e) {
  if ((e?.bot?.adapter?.name || e?.adapter_name) !== 'QQBot' || e.sub_type !== 'callback') return null
  const match = /^#JLPM:([a-f0-9]{24})$/.exec(e.msg || '')
  if (!match) return null
  const record = callbacks.get(match[1])
  if (!record) return null
  if (record.expires <= Date.now()) {
    callbacks.delete(match[1])
    return null
  }
  if (record.bridge) {
    if (!e.isMaster || String(e.self_id) !== record.bridge.self || String(e.group_id) !== record.bridge.group) return null
  } else {
    if (record.scope !== contextKey(e)) return null
    if (!e.isMaster && !(record.authorizedMaster && record.stableOwner && callbackOwner(e).stable)) return null
  }
  // 安装按钮只执行一次，防止连点重复启动 clone / pnpm。
  if (record.action.type === 'install') callbacks.delete(match[1])
  return record.action
}

export function managerMenu(e) {
  if (!isOfficialQQBot(e)) return []
  return [[
    callbackButton(e, '插件市场', { type: 'list', page: 1 }),
    callbackButton(e, '已安装', { type: 'installed' }),
    callbackButton(e, '使用帮助', { type: 'help' })
  ]]
}

export function listButtons(e, page, total) {
  if (!isOfficialQQBot(e)) return []
  const navigation = []
  if (page > 1) navigation.push(callbackButton(e, '上一页', { type: 'list', page: page - 1 }))
  if (page < total) navigation.push(callbackButton(e, '下一页', { type: 'list', page: page + 1 }))
  return [...(navigation.length ? [navigation] : []), ...managerMenu(e)]
}

export function installedButtons(e, page, total) {
  if (!isOfficialQQBot(e)) return []
  const navigation = []
  if (page > 1) navigation.push(callbackButton(e, '上一页', { type: 'installed', page: page - 1 }))
  if (page < total) navigation.push(callbackButton(e, '下一页', { type: 'installed', page: page + 1 }))
  return [...(navigation.length ? [navigation] : []), ...managerMenu(e)]
}

export function searchButtons(e, data, result, keyword) {
  if (!isOfficialQQBot(e)) return []
  const plugins = result.slice(data.start - 1, data.end)
  const rows = []
  for (let i = 0; i < plugins.length; i += 2) {
    rows.push(plugins.slice(i, i + 2).map((item, j) => callbackButton(e,
      `安装 ${String(data.start + i + j).padStart(2, '0')}`,
      { type: 'install', url: item.url },
      { style: 1, installName: item.pluginname || item.pathname }
    )))
  }
  const navigation = []
  if (data.page > 1) navigation.push(callbackButton(e, '上一页', { type: 'search', keyword, page: data.page - 1 }))
  if (data.page < data.pages) navigation.push(callbackButton(e, '下一页', { type: 'search', keyword, page: data.page + 1 }))
  if (navigation.length) rows.push(navigation)
  rows.push(...managerMenu(e))
  return rows // 最多 5 行，每行不超过 3 个按钮。
}

export async function replyWithInstallerButtons(e, message, rows = managerMenu(e)) {
  if (!isOfficialQQBot(e) || !rows.length || typeof globalThis.segment?.button !== 'function') return e.reply(message)
  const segments = Array.isArray(message) ? [...message] : [message]
  segments.push(globalThis.segment.button(...rows))
  // 引用原事件，使用 QQBot 被动回复；回调事件由适配器处理 interaction event_id。
  return e.reply(segments, true)
}
