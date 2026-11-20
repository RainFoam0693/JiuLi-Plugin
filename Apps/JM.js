import fs from 'node:fs'
import path from 'node:path'
import {
  canUseJm,
  isJmFeatureEnabled,
  ensureJmComicConfig,
  jmDataDir,
  readJmConfig,
  runJmcomic,
  runUtility,
  sendJmFile,
} from '../Model/JM.js'

const ALBUM_ID = /^#?jm(\d+)$/i

export class JM extends plugin {
  constructor() {
    super({
      name: '禁漫',
      dsc: '下载 JM 漫画并发送 PDF',
      event: 'message',
      priority: Number.MIN_SAFE_INTEGER,
      rule: [{ reg: ALBUM_ID, fnc: 'jm' }],
    })
  }

  async jm(e) {
    if (!canUseJm(e)) return e.reply('你不在 JM 功能用户白名单中', true)
    if (!isJmFeatureEnabled('download')) return e.reply('JM 下载功能已关闭', true)
    const id = ALBUM_ID.exec(String(e.msg || ''))?.[1]
    if (!id) return e.reply('格式错误，请使用 #jm114514', true)

    let statusMessage
    let tempPdf
    let encryptedTempPdf
    let mangaDirectory
    try {
      statusMessage = await e.reply('开始获取，请稍等……', true)
      const optionPath = await ensureJmComicConfig()
      const { stdout = '', stderr = '' } = await runJmcomic([id, `--option=${optionPath}`], { timeout: 15 * 60 * 1000 })
      const output = `${stdout}\n${stderr}`
      const successLine = output.split(/\r?\n/).find(line => line.includes('本子获取成功'))
      const info = this.parseLogLine(successLine)
      if (!info?.title) throw new Error('没有从 JM 输出中解析到作品标题')

      const dirs = await fs.promises.readdir(jmDataDir, { withFileTypes: true })
      mangaDirectory = dirs.find(entry => entry.isDirectory() && entry.name.includes(info.title))?.name
      if (!mangaDirectory) throw new Error(`下载目录未找到：${info.title}`)

      const mangaPath = path.join(jmDataDir, mangaDirectory)
      const images = (await fs.promises.readdir(mangaPath))
        .filter(file => /\.(jpe?g|png)$/i.test(file))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(file => path.join(mangaPath, file))
      if (!images.length) throw new Error('下载目录中没有可转换的图片')
      info.y = images.length

      const pdfPath = path.join(jmDataDir, `${id}.pdf`)
      tempPdf = `${pdfPath}.plain.tmp.pdf`
      encryptedTempPdf = `${pdfPath}.encrypted.tmp.pdf`
      await runUtility('img2pdf', [...images, '--output', tempPdf], { timeout: 5 * 60 * 1000 })
      await runUtility('qpdf', ['--encrypt', id, id, '256', '--', tempPdf, encryptedTempPdf], { timeout: 5 * 60 * 1000 })
      await fs.promises.rename(encryptedTempPdf, pdfPath)
      await fs.promises.rm(tempPdf, { force: true })
      tempPdf = undefined
      encryptedTempPdf = undefined
      await fs.promises.rm(mangaPath, { recursive: true, force: true })
      mangaDirectory = undefined

      await this.recallStatus(e, statusMessage)
      statusMessage = undefined
      await e.reply(`标题：${info.title}\nID：${id}\n页数：${info.y}\nPDF 密码：${id}`, true)
      await sendJmFile(e, pdfPath)
      await this.saveInfo(id, { ...info, id, title: info.title })
      await this.cleanupCache(readJmConfig().cacheLimit)
      return true
    } catch (error) {
      logger.error('[JM] 下载失败：', error)
      await this.recallStatus(e, statusMessage)
      if (tempPdf) await fs.promises.rm(tempPdf, { force: true }).catch(() => {})
      if (encryptedTempPdf) await fs.promises.rm(encryptedTempPdf, { force: true }).catch(() => {})
      const message = error.code === 'ENOENT'
        ? `缺少外部依赖 ${error.path || error.syscall || ''}。请安装 jmcomic、img2pdf 和 qpdf，并确认它们在 PATH 中。`
        : '本子下载或发送失败，请查看日志中的 [JM] 错误详情。'
      await e.reply(message, true)
      return true
    }
  }

  parseLogLine(line = '') {
    const value = (label) => line.match(new RegExp(`${label}[:：]?\\s*\\[([^\\]]+)\\]`))?.[1]
    return {
      id: line.match(/本子获取成功: ?\[(\d+)\]/)?.[1] || null,
      author: value('作者') || null,
      title: value('标题') || null,
      p: value('章节数') || '1',
      y: value('总页数') || '0',
      keyword: [],
    }
  }

  async recallStatus(e, message) {
    if (!message?.message_id) return
    const target = e?.isGroup ? e.group : e.friend
    try { await target?.recallMsg?.(message.message_id) } catch { /* 不支持撤回时保留状态消息。 */ }
  }

  async saveInfo(id, info) {
    const file = path.join(jmDataDir, '本子信息.json')
    let data = {}
    try { data = JSON.parse(await fs.promises.readFile(file, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    data[id] = info
    await fs.promises.writeFile(file, JSON.stringify(data, null, 2), 'utf8')
  }

  async cleanupCache(limit) {
    const files = (await fs.promises.readdir(jmDataDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^\d+\.pdf$/i.test(entry.name))
    const stats = await Promise.all(files.map(async entry => ({
      name: entry.name,
      mtime: (await fs.promises.stat(path.join(jmDataDir, entry.name))).mtimeMs,
    })))
    stats.sort((a, b) => a.mtime - b.mtime)
    while (stats.length > limit) {
      const oldest = stats.shift()
      await fs.promises.rm(path.join(jmDataDir, oldest.name), { force: true })
    }
  }
}
