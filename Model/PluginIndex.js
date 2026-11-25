/**
 * 有点看不懂此插件逻辑QWQ
 *
 */



import { fetchPluginSources } from './PluginApi.js'

const CACHE_TTL = 10 * 60 * 1000
const RETRY_TTL = 60 * 1000
const DESCRIPTION_LIMIT = 140
let cache = null
let pending = null
let retryAfter = 0

export function repositoryUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || !['github.com', 'gitee.com', 'gitcode.com', 'gitcode.net'].includes(url.hostname)) throw new Error('请提供 GitHub / Gitee / GitCode 的 HTTPS 仓库地址')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2) throw new Error('请提供仓库首页地址')
  const name = decodeURIComponent(parts[1]).replace(/\.git$/, '')
  if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') throw new Error('仓库名称格式不正确')
  return { url: `https://${url.hostname}/${parts[0]}/${name}`, pathname: name }
}

function safeRepository(value) {
  try {
    return repositoryUrl(value).url
  } catch {
    return ''
  }
}

/** 接口条目统一成安装与卡片使用的字段。 */
function parseApiEntries(records) {
  const entries = []
  for (const { item, source } of records) {
    try {
      const repo = repositoryUrl(item.url || item.html_url || item.clone_url)
      const pluginname = String(item.name || item.pluginname || item.repo || repo.pathname).trim()
      const owner = String(item.owner || item.author || '').trim()
      const aliases = [...pluginname.matchAll(/[（(]([\w.@-]+)[）)]/g)].map(match => match[1])
      if (item.repo) aliases.push(String(item.repo))
      if (owner && item.repo) aliases.push(`${owner}/${item.repo}`)
      const describe = String(item.description || item.describe || '').trim()
      const clone = safeRepository(item.clone_url)
      entries.push({
        ...repo,
        pluginname,
        aliases,
        author: owner,
        // 接口简介通常很长，截断后保持原版卡片的高度。
        describe: describe.length > DESCRIPTION_LIMIT ? `${describe.slice(0, DESCRIPTION_LIMIT)}…` : describe,
        category: item.category?.name || String(item.category || source),
        clone_url: clone ? `${clone}.git` : '',
        mirrors: (Array.isArray(item.mirrors) ? item.mirrors : []).map(safeRepository).filter(Boolean)
      })
    } catch { /* 地址不规范的条目跳过 */ }
  }
  return [...new Map(entries.map(entry => [entry.url.toLowerCase(), entry])).values()]
}

/** 只读接口：缓存 10 分钟；刷新失败时使用上次缓存，没有缓存则报错。 */
export async function fetchPluginIndex(fetcher = globalThis.fetch) {
  if (cache && Date.now() < Math.max(cache.time + CACHE_TTL, retryAfter)) return cache.entries
  if (pending) return pending
  pending = (async () => {
    try {
      const entries = parseApiEntries(await fetchPluginSources(fetcher))
      if (!entries.length) throw new Error('接口没有可安装的插件')
      cache = { time: Date.now(), entries }
      return entries
    } catch (error) {
      if (cache) {
        retryAfter = Date.now() + RETRY_TTL
        globalThis.logger?.warn(`[插件管理器] 插件接口不可用，使用上次缓存：${error.message}`)
        return cache.entries
      }
      throw new Error(`读取插件索引失败：${error.message}`)
    }
  })()
  try { return await pending } finally { pending = null }
}

/** 清空缓存，下次读取重新请求接口。 */
export function clearPluginIndexCache() {
  cache = null
  pending = null
  retryAfter = 0
}
