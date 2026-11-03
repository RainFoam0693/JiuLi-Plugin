/** 构建搜索卡片；模板默认转义所有索引文本，避免把 Markdown 内容当 HTML。 */
export function buildSearchPages(result, keyword, generatedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })) {
  const selected = result.slice(0, 30)
  const pages = []
  for (let offset = 0; offset < selected.length; offset += 6) {
    pages.push({
      keyword, generatedAt, total: result.length, shown: selected.length,
      page: pages.length + 1, pages: Math.ceil(selected.length / 6),
      start: offset + 1, end: Math.min(offset + 6, selected.length),
      plugins: selected.slice(offset, offset + 6).map((item, i) => {
        const url = new URL(item.url)
        return {
          number: String(offset + i + 1).padStart(2, '0'),
          name: item.pluginname || item.pathname,
          author: item.author || '未知作者', category: item.category || '插件',
          description: item.describe || '该插件暂无简介。',
          host: ({ 'github.com': 'GitHub', 'gitee.com': 'Gitee', 'gitcode.com': 'GitCode' })[url.hostname] || url.hostname,
          repository: url.pathname.slice(1), command: `#安装插件 ${item.pathname}`
        }
      })
    })
  }
  return pages
}

/** 全市场按六项分页，不受搜索前 30 项限制。 */
export function buildMarketPage(entries, page) {
  const pages = Math.ceil(entries.length / 6)
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) return null
  const offset = (page - 1) * 6
  const data = buildSearchPages(entries.slice(offset, offset + 6), '全部插件 · 功能 / 游戏 IP / 文游')[0]
  Object.assign(data, { total: entries.length, shown: entries.length, page, pages, start: offset + 1, end: Math.min(offset + 6, entries.length), heading: '插件市场', viewLabel: '插件索引', counterLabel: '收录插件 · PLUGINS', hint: '发送 #插件列表页码 翻页，例如 #插件列表2。' })
  data.plugins.forEach((item, i) => { item.number = String(offset + i + 1).padStart(2, '0') })
  return data
}

/** 本地插件图鉴；缺少索引或仓库地址时仍能展示本地目录。 */
export function buildInstalledPage(entries, page) {
  const data = buildMarketPage(entries.map(item => ({ ...item, url: `https://local.invalid/${encodeURIComponent(item.pathname)}` })), page)
  if (!data) return null
  Object.assign(data, { heading: '已安装插件', keyword: '本地插件 · 安装目录一览', viewLabel: '本地插件', counterLabel: '已安装 · INSTALLED', hint: '发送 #已安装插件2 查看下一页。', notice: '下方为本地目录对应的卸载指令，请确认插件后再执行。' })
  data.plugins.forEach((item, i) => {
    const entry = entries[data.start - 1 + i]
    Object.assign(item, { host: 'LOCAL', repository: `plugins/${entry.pathname}`, category: entry.category || '本地插件', commandLabel: 'UNINSTALL COMMAND', command: `#卸载插件 ${entry.pathname}` })
  })
  return data
}
