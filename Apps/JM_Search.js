import { canUseJm, runPython, sendJmForward } from '../Model/JM.js'

export class JM_Search extends plugin {
  constructor() {
    super({
      name: '禁漫搜索',
      dsc: '搜索 JM 漫画',
      event: 'message',
      priority: Number.MIN_SAFE_INTEGER,
      rule: [{ reg: /^#?(?:jm|禁漫)搜索\s*(.*)$/i, fnc: 'jm' }],
    })
  }

  async jm(e) {
    if (!canUseJm(e)) return e.reply('你不在 JM 功能用户白名单中', true)
    if (!isJmFeatureEnabled('search')) return e.reply('JM 搜索功能已关闭', true)
    const keyword = String(e.msg || '').match(/^#?(?:jm|禁漫)搜索\s*(.*)$/i)?.[1]?.trim() || ''
    if (!keyword) return e.reply('请提供搜索关键词，例如：#jm搜索 原神', true)
    try {
      const { stdout = '' } = await runPython('jmcomic_search.py', [keyword], { timeout: 3 * 60 * 1000 })
      const results = stdout.split(/\r?\n/).filter(line => /^\[\d+\]:/.test(line.trim())).map(line => line.trim()).slice(0, 100)
      if (!results.length) return e.reply('没有找到相关作品', true)
      const chunks = []
      for (let i = 0; i < results.length; i += 10) chunks.push(results.slice(i, i + 10).join('\n'))
      const entries = chunks.map(message => ({
        nickname: e.sender?.nickname || 'JM 搜索',
        user_id: e.user_id,
        message,
      }))
      return sendJmForward(e, entries, `JM 搜索结果（最多显示 100 条）\n\n${results.join('\n')}`)
    } catch (error) {
      logger.error('[JM] 搜索失败：', error)
      return e.reply(error.code === 'ENOENT' ? '找不到 Python 3 或 jmcomic 依赖，请检查安装和 config/JM.yaml。' : 'JM 搜索失败，请查看日志中的 [JM] 错误详情。', true)
    }
  }
}
