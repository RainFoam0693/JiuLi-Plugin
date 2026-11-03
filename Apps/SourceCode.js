import fs from "node:fs/promises"
import File from "../Model/file.js"
import path from "path"
import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import { getBaiduLatency } from "../Model/latency.js"

const htmlDir = `${process.cwd()}/plugins/JiuLi-Plugin/Resources/SourceCode/`
const tplFile = `${htmlDir}SourceCode.html`

async function getLocalBg() {
  const bgDir = `${process.cwd()}/plugins/JiuLi-Plugin/Resources/Code/bg`
  try {
    const files = (await fs.readdir(bgDir)).filter(f => /\.(?:jpe?g|png|webp)$/i.test(f))
    if (files.length) {
      const file = files[Math.floor(Math.random() * files.length)]
      const buffer = await fs.readFile(path.join(bgDir, file))
      const ext = path.extname(file).slice(1).toLowerCase()
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      return `data:${mime};base64,${buffer.toString('base64')}`
    }
  } catch {}
  return ''
}

async function getBgData() {
  const url = 'https://t.alcy.cc/mp'
  for (let i = 0; i < 3; i++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeout)
      const contentType = response.headers.get('content-type') || ''
      if (response.ok && contentType.startsWith('image/')) {
        const buffer = Buffer.from(await response.arrayBuffer())
        return `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`
      }
    } catch (e) {}
    if (i < 2) await new Promise(r => setTimeout(r, 500))
  }
  return await getLocalBg()
}

export class SourceCode extends plugin {
  constructor() {
    super({
      name: "SourceCode",
      dsc: "SourceCode",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: "^sc(\\d+~\\d+)?.+",
          fnc: "SourceCode"
        }
      ]
    })
  }

  async SourceCode() {
    if(!this.e.isMaster)return false
    const msg = this.e.msg.replace(/sc(\d+~\d+)?/, "").trim()
    logger.mark(`[SourceCode] 查看：${logger.blue(msg)}`)

    let scFile = msg
    if (/^https?:\/\//.test(msg)) {
      scFile = `${process.cwd()}/data/cache.sc`
      const ret = await Bot.download(msg, scFile)
      if (!ret) {
        await this.reply("文件下载错误", true)
        return false
      }
    }

    scFile = await new File(this).choose(scFile)
    if (!scFile) {
      await this.reply("文件不存在", true)
      return false
    }
    let fData = await fs.readFile(scFile, "utf-8")
    const rows = this.e.msg.match(/sc(\d+~\d+)/)?.[1]?.split("~")
    if (rows) {
      fData = fData.split("\n").slice(rows[0] - 1, rows[1]).join("\n")
    }
    console.log(fData);
    const SourceCode = fData
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/ /g, "&nbsp;")
    const fileSuffix = path.extname(scFile).slice(1)
    const [bgData, baiduLatency] = await Promise.all([getBgData(), getBaiduLatency()])
    const img = await puppeteer.screenshots("SourceCode", {
      tplFile, htmlDir, SourceCode, fileSuffix,
      lnStart: (rows && rows[0]) || 1,
      multiPageHeight: 20000,
      bgData,
      baidu_latency: baiduLatency
    })

    await this.reply(img, true)
  }
}
