/**
 * 
 *Yunzai社区-Git收录接口无敌了好吧
 * 社区&插件库同时同步，双收录
 * 这RainFoam0693嘿壳直接读取插件库没啥意思
 */

export const PLUGIN_SOURCES = [
  {
    name: '功能插件',
    url: 'https://git.yzai.top/api.php?action=function_plugins'
  },
  {
    name: '游戏插件',
    url: 'https://git.yzai.top/api.php?action=game_plugins'
  },
  {
    name: '文游插件',
    url: 'https://git.yzai.top/api.php?action=word_game_plugins'
  }
]

const TIMEOUT = 15000

/**
 * 并发读取全部接口，返回 [{ item, source }]。
 * 单个接口失败时继续用另一个；全部失败才抛错，由索引层回退 Markdown。
 */
export async function fetchPluginSources (fetcher = globalThis.fetch, sources = PLUGIN_SOURCES) {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('未配置插件接口')
  if (typeof fetcher !== 'function') throw new Error('当前环境不支持 fetch')

  const results = await Promise.allSettled(sources.map(source => fetchOne(source, fetcher)))
  const records = []
  const errors = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') records.push(...result.value)
    else errors.push(`${sources[index].name}：${result.reason?.message || result.reason}`)
  })

  if (records.length === 0) throw new Error(errors.join('；') || '插件接口不可用')
  return records
}

async function fetchOne (source, fetcher) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const response = await fetcher(source.url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    const items = itemsOf(payload)
    if (!items.length) throw new Error('没有返回插件条目')
    return items.map(item => ({ item, source: source.name }))
  } finally {
    clearTimeout(timer)
  }
}

function itemsOf (payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const data = payload.data
  if (Array.isArray(data)) return data
  const list = data?.items || data?.plugins || data?.list || payload.items || payload.plugins || payload.list
  return Array.isArray(list) ? list : []
}
