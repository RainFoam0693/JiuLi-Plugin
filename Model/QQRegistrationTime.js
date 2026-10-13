const PROFILE_KEYS = [
  101, 102, 103, 105, 107, 20002, 20003, 20004,
  20009, 20011, 20021, 20026, 20031, 20037, 27394
]
const PROFILE_KEY_SET = new Set(PROFILE_KEYS)
const DATE_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
})

export const QQ_REGISTRATION_RULE = /^#?QQ注册(?:时间|信息)?\s*(\d+)?\s*$/i

export function isICQQ (bot) {
  const adapterName = String(bot?.adapter?.name || "").toLowerCase()
  const versionName = String(bot?.version?.name || "").toLowerCase()
  return adapterName.includes("icqq") || versionName.includes("icqq")
}

export function getTargetQQ (event, match) {
  const atList = Array.isArray(event?.at) ? event.at : [event?.at]
  const at = atList.find(value => /^\d+$/.test(String(value || "")))
  const value = at || match?.[1] || event?.user_id
  if (!/^\d+$/.test(String(value || ""))) {
    return null
  }

  const target = Number(value)
  return Number.isSafeInteger(target) && target >= 10000 ? target : null
}

export async function queryQQArchive (bot, target) {
  const [profile, privileges, status] = await Promise.all([
    fetchICQQProfile(bot, target),
    fetchPrivileges(bot, target),
    fetchStatus(bot, target)
  ])

  if (!profile || (!profile.nickname && !profile.regTimestamp)) {
    return null
  }

  return formatArchive(bot, target, profile, privileges, status)
}

export function formatArchive (bot, target, profile, privileges = {}, status) {
  const registration = describeTimestamp(profile.regTimestamp, true)
  const avatarChanged = describeTimestamp(profile.avatarTimestamp)
  const level = toNumber(profile.level)
  const gender = formatGender(profile.sex)
  const location = [cleanText(profile.country), cleanText(profile.city)].filter(Boolean).join(" · ") || "未公开"

  return {
    target,
    avatar: `https://q.qlogo.cn/g?b=qq&s=640&nk=${target}`,
    nickname: cleanText(profile.nickname) || "未知用户",
    relationship: getRelationship(bot, target, profile.remark),
    status: formatStatus(status),
    level: level === undefined ? "未公开" : `LV${level}`,
    levelIcons: level === undefined ? "" : levelIcons(level),
    levelBadges: level === undefined ? [] : levelBadges(level),
    qid: cleanText(profile.QID) || "未设置",
    gender,
    age: formatAge(profile.age),
    birthday: formatBirthday(profile.birthday),
    location,
    school: cleanText(profile.school) || "未公开",
    mail: cleanText(profile.mail) || "未公开",
    signature: cleanText(profile.signature, 100) || "这个人很神秘，还没有写签名。",
    registrationTime: registration.time,
    registrationElapsed: registration.elapsed,
    avatarChanged: avatarChanged.time,
    businesses: Array.isArray(privileges.items) ? privileges.items : [],
    businessAvailable: Boolean(privileges.available),
    generatedAt: DATE_FORMATTER.format(new Date())
  }
}

export function archiveToText (data) {
  const businesses = data.businessAvailable
    ? data.businesses.join(" | ") || "未查询到已开通业务"
    : "接口未返回"

  return [
    "QQ 账号档案",
    "━━━━━━━━━━━━",
    `昵称：${data.nickname}`,
    `账号：${data.target}`,
    `关系：${data.relationship}`,
    `状态：${data.status}`,
    `等级：${data.level}${data.levelIcons ? ` ${data.levelIcons}` : ""}`,
    `QID：${data.qid}`,
    `性别/年龄：${data.gender} / ${data.age}`,
    `生日：${data.birthday}`,
    `地区：${data.location}`,
    `学校：${data.school}`,
    `邮箱：${data.mail}`,
    `签名：${data.signature}`,
    "",
    "时间档案",
    "━━━━━━━━━━━━",
    `注册时间：${data.registrationTime}`,
    `注册至今：${data.registrationElapsed}`,
    `头像修改：${data.avatarChanged}`,
    "",
    "开通业务",
    "━━━━━━━━━━━━",
    businesses
  ].join("\n")
}

async function fetchICQQProfile (bot, target) {
  const client = bot?.sdk || bot
  const getProfile = bindMethod(bot, "getProfile") || bindMethod(client, "getProfile")

  if (getProfile) {
    try {
      const profile = await getProfile(target, profileParsers())
      if (profile && Object.keys(profile).length > 1) {
        return normalizeNativeProfile(profile)
      }
    } catch (error) {
      logger.debug(`[TRSS-Plugin][QQ账号档案] getProfile 降级：${error?.message || error}`)
    }
  }

  const sendOidb = bindMethod(client, "sendOidbSvcTrpcTcp") || bindMethod(bot, "sendOidbSvcTrpcTcp")
  if (sendOidb) {
    try {
      const response = await sendOidb("OidbSvcTrpcTcp.0xfe1_2", {
        1: [target],
        3: { 1: PROFILE_KEYS }
      }, { message_type: 0 })
      const fields = collectProfileFields(response)
      if (fields.size) {
        return normalizeFieldProfile(fields)
      }
    } catch (error) {
      logger.debug(`[TRSS-Plugin][QQ账号档案] 0xfe1_2 降级：${error?.message || error}`)
    }
  }

  const getStrangerInfo = bindMethod(bot, "getStrangerInfo") || bindMethod(client, "getStrangerInfo")
  if (getStrangerInfo) {
    try {
      const basic = await getStrangerInfo(target)
      if (basic) {
        return normalizeNativeProfile(basic)
      }
    } catch (error) {
      logger.debug(`[TRSS-Plugin][QQ账号档案] getStrangerInfo 降级：${error?.message || error}`)
    }
  }

  const user = typeof bot?.pickUser === "function" ? bot.pickUser(target) : client?.pickUser?.(target)
  if (typeof user?.getSimpleInfo === "function") {
    return normalizeNativeProfile(await user.getSimpleInfo())
  }
  return null
}

async function fetchStatus (bot, target) {
  const client = bot?.sdk || bot
  const getStatusInfo = bindMethod(bot, "getStatusInfo") || bindMethod(client, "getStatusInfo")
  if (!getStatusInfo) {
    return null
  }
  try {
    return await getStatusInfo(target)
  } catch {
    return null
  }
}

async function fetchPrivileges (bot, target) {
  const client = bot?.sdk || bot
  const getCookies = bindMethod(bot, "getCookies") || bindMethod(client, "getCookies")
  try {
    let cookieText = getCookies ? await getCookies("vip.qq.com") : client?.cookies?.["vip.qq.com"]
    cookieText = cookieText?.cookies || cookieText?.cookie || cookieText
    const pskey = String(cookieText || "").match(/(?:^|;\s*)p_skey=([^;]+)/)?.[1]
    if (!pskey) {
      return { available: false, items: [] }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(`https://club.vip.qq.com/api/getPrivileges?g_tk=${getGTK(pskey)}&friend=${target}&isNewConfig=true`, {
        headers: {
          Cookie: `uin=${client.uin || bot.uin}; p_uin=${client.uin || bot.uin}; p_skey=${pskey}`,
          "User-Agent": "Mozilla/5.0 QQ/9.1",
          Referer: "https://club.vip.qq.com/"
        },
        signal: controller.signal
      })
      if (!response.ok) {
        return { available: false, items: [] }
      }

      const data = await response.json()
      const list = Array.isArray(data?.data?.comparePrivileges) ? data.data.comparePrivileges : []
      const items = list.map(item => {
        const name = cleanText(item.guestName || item.name)
        if (!name) {
          return ""
        }
        const level = toNumber(item.guestLevel ?? item.level)
        return `${item.guestIsYear ? "年费" : ""}${name}${level ? ` LV${level}` : ""}`
      }).filter(Boolean)
      return { available: true, items: [...new Set(items)] }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    logger.debug(`[TRSS-Plugin][QQ账号档案] 会员业务查询降级：${error?.message || error}`)
    return { available: false, items: [] }
  }
}

function bindMethod (target, key) {
  return typeof target?.[key] === "function" ? target[key].bind(target) : null
}

function profileParsers () {
  return {
    103: { key: "remark", parse: decodeText },
    20003: { key: "country", parse: decodeText },
    20004: { key: "city", parse: decodeText },
    20009: { key: "sexCode", parse: value => toNumber(value) },
    20011: { key: "mail", parse: decodeText },
    20021: { key: "school", parse: decodeText },
    20031: { key: "birthday", parse: parseBirthday }
  }
}

function normalizeNativeProfile (profile) {
  return {
    nickname: profile.nickname || profile.nick,
    level: profile.level || profile.qqLevel,
    QID: profile.QID || profile.qid,
    signature: profile.signature || profile.personalSign,
    remark: profile.remark,
    sex: profile.sexCode ?? profile.sex ?? profile.gender,
    age: profile.age,
    birthday: profile.birthday,
    country: profile.country,
    city: profile.city || profile.area,
    school: profile.school,
    mail: profile.mail || profile.email,
    regTimestamp: profile.regTimestamp ?? profile.registrationTime ?? profile.reg_time,
    avatarTimestamp: profile.avatar?.changeTimestamp ?? profile.avatarTimestamp
  }
}

function normalizeFieldProfile (fields) {
  return {
    nickname: decodeText(fields.get(20002)),
    level: fields.get(105),
    QID: decodeText(fields.get(27394)),
    signature: decodeText(fields.get(102)),
    remark: decodeText(fields.get(103)),
    sex: fields.get(20009),
    age: fields.get(20037),
    birthday: parseBirthday(fields.get(20031)),
    country: decodeText(fields.get(20003)),
    city: decodeText(fields.get(20004)),
    school: decodeText(fields.get(20021)),
    mail: decodeText(fields.get(20011)),
    regTimestamp: fields.get(20026),
    avatarTimestamp: fields.get(101)?.[3]
  }
}

function collectProfileFields (value, result = new Map(), visited = new Set()) {
  if (!value || typeof value !== "object" || value instanceof Uint8Array || visited.has(value)) {
    return result
  }
  visited.add(value)
  if (!Array.isArray(value)) {
    const key = toNumber(value[1])
    if (PROFILE_KEY_SET.has(key) && Object.prototype.hasOwnProperty.call(value, 2)) {
      result.set(key, value[2])
    }
  }
  for (const child of Object.values(value)) {
    collectProfileFields(child, result, visited)
  }
  return result
}

function decodeText (value) {
  if (typeof value === "string") {
    return value
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value)
  }
  return value === undefined || value === null ? "" : String(value)
}

function parseBirthday (value) {
  if (typeof value === "string") {
    return value
  }
  if (!(value instanceof Uint8Array) || value.length < 4) {
    return ""
  }
  const year = (value[0] << 8) | value[1]
  const month = value[2]
  const day = value[3]
  if (!month || !day) {
    return ""
  }
  return `${year || "----"}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function toNumber (value) {
  if (typeof value === "bigint") {
    return Number(value)
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function normalizeTimestamp (value) {
  let timestamp = toNumber(value)
  if (!timestamp || timestamp < 1) {
    return undefined
  }
  if (timestamp < 10 ** 11) {
    timestamp *= 1000
  }
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function describeTimestamp (value, includeElapsed = false) {
  const date = normalizeTimestamp(value)
  if (!date) {
    return { time: "协议未返回", elapsed: "协议未返回" }
  }
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
  return {
    time: DATE_FORMATTER.format(date),
    elapsed: includeElapsed ? `${days.toLocaleString("zh-CN")} 天（约 ${(days / 365.2425).toFixed(1)} 年）` : ""
  }
}

function formatGender (value) {
  if (value === 1 || value === "male" || value === "男") {
    return "男"
  }
  if (value === 2 || value === "female" || value === "女") {
    return "女"
  }
  return "未公开"
}

function formatStatus (info) {
  if (!info) {
    return "协议未返回"
  }
  const code = toNumber(info.onlineStatus ?? info.status)
  const labels = {
    0: "离线",
    11: "在线",
    31: "离开",
    41: "隐身",
    50: "忙碌",
    60: "Q我吧",
    70: "请勿打扰"
  }
  const status = labels[code] || (code === undefined ? "未知" : `未知(${code})`)
  const device = cleanText(info.termDesc, 24)
  return device ? `${status} · ${device}` : status
}

function getRelationship (bot, target, remark) {
  const client = bot?.sdk || bot
  const friends = bot?.fl || client?.fl
  const isFriend = typeof friends?.has === "function" && friends.has(target)
  if (!isFriend) {
    return "非机器人好友"
  }
  const friend = friends.get(target)
  const friendRemark = cleanText(remark || friend?.remark || friend?.nickname)
  return friendRemark ? `机器人好友（备注：${friendRemark}）` : "机器人好友"
}

function formatBirthday (value) {
  const birthday = cleanText(value)
  return birthday || "未公开"
}

function formatAge (value) {
  const age = toNumber(value)
  return age === undefined || age <= 0 ? "未公开" : `${age} 岁`
}

function cleanText (value, maxLength = 40) {
  const text = decodeText(value).replace(/[\r\n\t]+/g, " ").trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function getGTK (pskey) {
  let hash = 5381
  for (const char of pskey) {
    hash = hash * 33 + char.charCodeAt(0)
    if (hash > 0x7fffffff) {
      hash &= 0x7fffffff
    }
  }
  return hash
}

function levelIcons (level) {
  if (!Number.isInteger(level) || level < 0) {
    return ""
  }
  return levelCounts(level).filter(item => item.count > 0).map(item => `${item.label}×${item.count}`).join(" ")
}

function levelBadges (level) {
  if (!Number.isInteger(level) || level < 0) {
    return []
  }
  return levelCounts(level).flatMap(item => Array.from({ length: item.count }, () => ({
    icon: item.icon,
    label: item.label
  })))
}

function levelCounts (level) {
  const remaining = level % 256
  return [
    { icon: "time-penguin.png", label: "时光企鹅", count: Math.floor(level / 256) },
    { icon: "crown.png", label: "皇冠", count: Math.floor(remaining / 64) },
    { icon: "sun.png", label: "太阳", count: Math.floor((remaining % 64) / 16) },
    { icon: "moon.png", label: "月亮", count: Math.floor((remaining % 16) / 4) },
    { icon: "star.png", label: "星星", count: remaining % 4 }
  ]
}
