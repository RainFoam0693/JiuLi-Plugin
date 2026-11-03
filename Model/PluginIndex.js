import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: false })
export const INDEX_REPOSITORY = 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index'
export const INDEX_FILES = ['Function-Plugin.md', 'Game-Plugin.md', 'WordGame-Plugin.md']
const categories = ['功能类', '游戏 IP 类', '文游类']
let cache = null
let pending = null

function inline(cell) {
  return markdown.parseInline(cell, {})[0]?.children || []
}
function text(cell) {
  return inline(cell).filter(t => ['text', 'code_inline', 'image'].includes(t.type)).map(t => t.content).join('').replace(/<[^>]*>/g, '').trim()
}
export function repositoryUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || !['github.com', 'gitee.com', 'gitcode.com', 'gitcode.net'].includes(url.hostname)) throw new Error('请提供 GitHub / Gitee / GitCode 的 HTTPS 仓库地址')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2) throw new Error('请提供仓库首页地址')
  const name = decodeURIComponent(parts[1]).replace(/\.git$/, '')
  if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') throw new Error('仓库名称格式不正确')
  return { url: `https://${url.hostname}/${parts[0]}/${name}`, pathname: name }
}

export function parsePluginMarkdown(source, category = '') {
  const entries = []
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(s => s.replace(/\\\|/g, '|').trim())
    if (cells.length < 3) continue
    const tokens = inline(cells[0])
    const link = tokens.find(t => t.type === 'link_open')?.attrGet('href')
    if (!link) continue
    try {
      const repo = repositoryUrl(link)
      const pluginname = text(cells[0])
      const aliases = [...pluginname.matchAll(/[（(]([\w.@-]+)[）)]/g)].map(m => m[1])
      entries.push({ ...repo, pluginname, aliases, author: text(cells[1]), describe: text(cells.slice(2).join(' | ')), category })
    } catch { /* 非仓库链接不作为可安装条目。 */ }
  }
  return entries
}

/** 直接读取三个 Markdown 原文；不使用插件列表或仓库搜索 API。 */
export async function fetchPluginIndex(fetcher = globalThis.fetch) {
  if (cache && Date.now() - cache.time < 10 * 60 * 1000) return cache.entries
  if (pending) return pending
  pending = (async () => {
    try {
      const groups = await Promise.all(INDEX_FILES.map(async (file, i) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 20000)
        try {
          const response = await fetcher(`${INDEX_REPOSITORY}/raw/main/${file}`, { signal: controller.signal })
          if (!response.ok) throw new Error(`${file} HTTP ${response.status}`)
          const entries = parsePluginMarkdown(await response.text(), categories[i])
          if (!entries.length) throw new Error(`${file} 未解析到插件条目`)
          return entries
        } finally { clearTimeout(timer) }
      }))
      const entries = [...new Map(groups.flat().map(item => [item.url.toLowerCase(), item])).values()]
      cache = { time: Date.now(), entries }
      return entries
    } catch (error) {
      if (cache) {
        globalThis.logger?.warn(`[插件管理器] 索引刷新失败，使用上次缓存：${error.message}`)
        return cache.entries
      }
      throw new Error(`读取插件索引失败：${error.message}`)
    }
  })()
  try { return await pending } finally { pending = null }
}
