import fs from "node:fs/promises"
import File from "../Model/file.js"
import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import MarkdownIt from "markdown-it"
import path from "path"
import { getBaiduLatency } from "../Model/latency.js"
const md = new MarkdownIt({ html: true })

const htmlDir = `${process.cwd()}/plugins/JiuLi-Plugin/Resources/Markdown/`
const tplFile = `${htmlDir}Markdown.html`

// 本地 fallback 背景图
async function getLocalBg() {
  const bgDir = `${process.cwd()}/plugins/JiuLi-Plugin/Resources/Code/bg`
  try {
    const files = (await fs.readdir(bgDir)).filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg') || f.endsWith('.webp'))
    if (files.length > 0) {
      const file = files[Math.floor(Math.random() * files.length)]
      const buffer = await fs.readFile(path.join(bgDir, file))
      const ext = file.split('.').pop()
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      return `data:${mime};base64,${buffer.toString('base64')}`
    }
  } catch {}
  return ''
}

// 背景图获取（远程优先，失败用本地 fallback）
async function getBgData() {
  const remoteUrl = 'https://t.alcy.cc/mp'
  for (let i = 0; i < 3; i++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(remoteUrl, { signal: controller.signal })
      clearTimeout(timeout)
      const contentType = response.headers.get('content-type') || ''
      if (contentType.startsWith('image/')) {
        const buffer = await response.arrayBuffer()
        const base64 = Buffer.from(buffer).toString('base64')
        const mime = contentType.split(';')[0]
        return `data:${mime};base64,${base64}`
      }
    } catch (e) {}
    if (i < 2) await new Promise(r => setTimeout(r, 500))
  }
  return await getLocalBg()
}

export class Markdown extends plugin {
  constructor() {
    super({
      name: "Markdown",
      dsc: "Markdown",
      event: "message",
      priority: 10,
      rule: [
        {
          reg: "^md.+",
          fnc: "Markdown"
        }
      ]
    })
  }

  async Markdown(e) {
    if(!this.e.isMaster)return false
    const msg = this.e.msg.replace("md", "").trim()
    logger.mark(`[Markdown] 查看：${logger.blue(msg)}`)

    let mdFile = msg
    if (/^https?:\/\//.test(msg)) {
      mdFile = `${process.cwd()}/data/cache.md`
      const ret = await Bot.download(msg, mdFile)
      if (!ret) {
        await this.reply("文件下载错误", true)
        return false
      }
    }

    mdFile = await new File(this).choose(mdFile)
    if (!mdFile) {
      await this.reply("文件不存在", true)
      return false
    }

    const Markdown = md.render(await fs.readFile(mdFile, "utf-8"))
    const [bgData, baiduLatency] = await Promise.all([getBgData(), getBaiduLatency()])
    const img = await puppeteer.screenshot("Markdown", {
      tplFile,
      htmlDir,
      Markdown,
      background: bgData,
      baidu_latency: baiduLatency,
      pageGotoParams: {
        waitUntil: "networkidle2"
      }
    })

    await this.reply(img, true)
  }
}
