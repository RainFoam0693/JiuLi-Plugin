import { canUseJm, runPython, sendJmForward } from '../Model/JM.js'

export class JM_Rank extends plugin {
  constructor() {
    super({
      name: '禁漫排行榜',
      dsc: '查看 JM 周排行榜',
      event: 'message',
      priority: Number.MIN_SAFE_INTEGER,
      rule: [{ reg: /^#?(?:jm|禁漫)(排行榜|热门(榜)?|rank)$/i, fnc: 'jm' }],
    })
  }

  async jm(e) {
    if (!canUseJm(e)) return e.reply('你不在 JM 功能用户白名单中', true)
    if (!isJmFeatureEnabled('rank')) return e.reply('JM 排行榜功能已关闭', true)
    try {
      const { stdout = '' } = await runPython('jmcomic_Rank.py', [], { timeout: 3 * 60 * 1000 })
      const results = stdout.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^\d+\s+.+/.test(line))
        .map(line => line.replace(/^(\d+)\s+(.+)$/, '[$1]: $2'))
        .slice(0, 100)
      if (!results.length) return e.reply('暂时没有排行榜信息', true)
      const chunks = []
      for (let i = 0; i < results.length; i += 10) chunks.push(results.slice(i, i + 10).join('\n'))
      const entries = chunks.map(message => ({
        nickname: e.sender?.nickname || 'JM 排行榜',
        user_id: e.user_id,
        message,
      }))
      return sendJmForward(e, entries, `JM 周排行榜\n\n${results.join('\n')}`)
    } catch (error) {
      logger.error('[JM] 排行榜获取失败：', error)
      return e.reply(error.code === 'ENOENT' ? '找不到 Python 3 或 jmcomic 依赖，请检查安装和 config/JM.yaml。' : '获取 JM 排行榜失败，请查看日志中的 [JM] 错误详情。', true)
    }
  }
}
