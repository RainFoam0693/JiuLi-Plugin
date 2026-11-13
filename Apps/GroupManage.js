import plugin from '../../../lib/plugins/plugin.js'

const NUM = '[零一壹二两三四五六七八九十百千万亿\\d]+'
const UNITS = '(秒|秒钟|分|分钟|时|小时|天|日)?'
const UNIT_SECONDS = { 秒: 1, 秒钟: 1, 分: 60, 分钟: 60, 时: 3600, 小时: 3600, 天: 86400, 日: 86400 }

function toNumber(value = '') {
  if (/^\d+$/.test(value)) return Number(value)
  const digits = { 零: 0, 一: 1, 壹: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const small = { 十: 10, 百: 100, 千: 1000 }
  let total = 0, section = 0, number = 0
  for (const char of value) {
    if (digits[char] !== undefined) number = digits[char]
    else if (small[char]) { section += (number || 1) * small[char]; number = 0 }
    else if (char === '万' || char === '亿') { section += number; total += (section || 1) * (char === '万' ? 10000 : 100000000); section = 0; number = 0 }
  }
  return total + section + number
}

function getTargets(e) {
  const mentions = e.raw?.mentions || []
  const ids = mentions.map(item => item?.member_openid || item?.user_id || item?.openid || item?.id).filter(Boolean)
  if (ids.length) return [...new Set(ids.map(String))]
  const selfId = String(e.self_id || '')
  const separator = e.bot?.adapter?.sep || ':'
  const explicit = e.msg.match(/(?:禁言|解禁|踢黑?|设置管理|取消管理)\s+([^\s]+)/)?.[1]
  if (!explicit) return []
  return [explicit.startsWith(`${selfId}${separator}`) ? explicit.slice(selfId.length + separator.length) : explicit]
}

function isOfficial(e) { return e.bot?.adapter?.name === 'QQBot' }
function isAdmin(e) {
  return Boolean(e.isMaster || e.member?.is_admin || e.member?.is_owner || e.sender?.role === 'admin' || e.sender?.role === 'owner')
}
function rawGroupId(e) { return e.raw_group_id || e.raw?.group_id || String(e.group_id || '').replace(`${e.self_id}${e.bot?.adapter?.sep || ':'}`, '') }

async function officialMute(e, target, seconds) {
  const groupId = rawGroupId(e)
  const sdk = e.bot?.sdk
  if (typeof sdk?.setGroupMemberMute !== 'function') throw new Error('当前 QQBot SDK 未提供群禁言接口')
  const members = seconds > 0
    ? [{ op: 'add', member_openid: target, mute_expire_at: new Date(Date.now() + seconds * 1000).toISOString() }]
    : [{ op: 'del', member_openid: target }]
  return sdk.setGroupMemberMute(groupId, members)
}

async function officialKick(e, target, blacklist) {
  const sdk = e.bot?.sdk
  if (typeof sdk?.group !== 'function') throw new Error('当前 QQBot SDK 未提供群成员管理接口')
  return sdk.group(rawGroupId(e)).removeMembers({ member_openids: [target], add_to_member_blacklist: Boolean(blacklist) })
}

export class GroupManage extends plugin {
  constructor() {
    super({
      name: 'JiuLi 群管理',
      dsc: '兼容 ICQQ 与 QQBot 官机的群禁言、解禁及踢人',
      event: 'message.group',
      priority: 400,
      rule: [
        { reg: '^#禁言(?:\\s+.+)?$', fnc: 'mute' },
        { reg: '^#解禁(?:\\s+[^\\s]+)?$', fnc: 'unmute' },
        { reg: '^#全体(?:禁言|解禁)$', fnc: 'muteAll' },
        { reg: '^#踢黑?(?:\\s+[^\\s]+)?$', fnc: 'kick' },
        { reg: '^#(?:设置|取消)管理(?:\\s+[^\\s]+)?$', fnc: 'setAdmin' }
      ]
    })
  }

  async ensurePermission(e, ownerOnly = false) {
    if (ownerOnly ? (e.isMaster || e.member?.is_owner || e.sender?.role === 'owner') : isAdmin(e)) return true
    await e.reply(ownerOnly ? '只有群主或机器人主人可以操作群管理权限' : '需要群管理员权限才能使用此命令', true)
    return false
  }

  async mute(e) {
    if (!await this.ensurePermission(e)) return true
    const targets = getTargets(e)
    const args = e.msg.replace(/^#禁言\s*/, '').trim().split(/\s+/).filter(Boolean)
    let target = targets[0] || ''
    let duration = args.join('')
    if (!target && args.length > 1) { target = args.shift(); duration = args.join('') }
    const durationMatch = duration.match(new RegExp(`^(${NUM})?${UNITS}$`))
    if (!target && durationMatch?.[1]) duration = ''
    if (!target) return e.reply('请艾特要禁言的成员，或使用 #禁言 <成员ID> <时长>分钟', true)
    const amountText = duration.match(new RegExp(`^${NUM}`))?.[0] || ''
    const unit = duration.match(new RegExp(`${UNITS}$`))?.[1] || '分'
    const amount = amountText ? toNumber(amountText) : 5
    const seconds = Math.min(30 * 86400, Math.max(1, amount * (UNIT_SECONDS[unit] || 60)))
    try {
      if (isOfficial(e)) await officialMute(e, target, seconds)
      else await e.group.muteMember(target, seconds)
      await e.reply(`✅ 已禁言成员 ${target} ${amount}${unit}`, true)
    } catch (error) { await e.reply(`禁言失败：${error?.message || error}`, true) }
    return true
  }

  async unmute(e) {
    if (!await this.ensurePermission(e)) return true
    const target = getTargets(e)[0]
    if (!target) return e.reply('请艾特要解禁的成员，或使用 #解禁 <成员ID>', true)
    try {
      if (isOfficial(e)) await officialMute(e, target, 0)
      else await e.group.muteMember(target, 0)
      await e.reply(`✅ 已解除成员 ${target} 的禁言`, true)
    } catch (error) { await e.reply(`解禁失败：${error?.message || error}`, true) }
    return true
  }

  async muteAll(e) {
    if (!await this.ensurePermission(e)) return true
    if (isOfficial(e)) return e.reply('QQBot 官机当前 SDK 未提供全体禁言接口', true)
    const enabled = /全体禁言/.test(e.msg)
    try {
      const result = await e.group.muteAll(enabled)
      await e.reply(result === false ? '操作失败' : `✅ 已${enabled ? '开启' : '解除'}全体禁言`, true)
    } catch (error) { await e.reply(`全体禁言操作失败：${error?.message || error}`, true) }
    return true
  }

  async kick(e) {
    if (!await this.ensurePermission(e)) return true
    const target = getTargets(e)[0]
    if (!target) return e.reply('请艾特要踢出的成员，或使用 #踢 <成员ID>', true)
    const blacklist = /踢黑/.test(e.msg)
    try {
      if (isOfficial(e)) await officialKick(e, target, blacklist)
      else await e.group.kickMember(target, blacklist)
      await e.reply(`✅ 已${blacklist ? '踢出并加入黑名单' : '踢出'}成员 ${target}`, true)
    } catch (error) { await e.reply(`踢人失败：${error?.message || error}`, true) }
    return true
  }

  async setAdmin(e) {
    if (!await this.ensurePermission(e, true)) return true
    if (isOfficial(e)) return e.reply('QQBot 官机当前 SDK 未提供设置群管理员接口', true)
    const target = getTargets(e)[0]
    if (!target) return e.reply('请艾特成员，或使用 #设置管理 <成员ID>', true)
    const enabled = /设置管理/.test(e.msg)
    try {
      const result = await e.group.setAdmin(target, enabled)
      await e.reply(result === false ? '设置群管理失败' : `✅ 已${enabled ? '设置' : '取消'}成员 ${target} 的管理员`, true)
    } catch (error) { await e.reply(`设置群管理失败：${error?.message || error}`, true) }
    return true
  }
}
