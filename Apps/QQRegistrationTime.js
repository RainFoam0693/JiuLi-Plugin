import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import { getBaiduLatency } from "../Model/latency.js"
import {
  QQ_REGISTRATION_RULE,
  archiveToText,
  getTargetQQ,
  isICQQ,
  queryQQArchive
} from "../Model/QQRegistrationTime.js"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const htmlDir = `${path.join(pluginRoot, "Resources", "QQRegistrationTime")}${path.sep}`
const tplFile = `${htmlDir}QQRegistrationTime.html`
const iconBase = `${pathToFileURL(path.join(htmlDir, "icons")).href}/`
const bgDir = path.join(pluginRoot, "Resources", "Code", "bg")

export class QQRegistrationTime extends plugin {
  constructor () {
    super({
      name: "QQ账号档案-ICQQ",
      dsc: "通过 ICQQ 查询 QQ 注册时间和公开资料",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: QQ_REGISTRATION_RULE,
          fnc: "queryQQProfile"
        }
      ]
    })
  }

  async queryQQProfile (e) {
    if (!isICQQ(e.bot)) {
      await e.reply("QQ 注册时间查询仅支持 ICQQ 适配器", true)
      return true
    }

    const target = getTargetQQ(e, e.msg.match(QQ_REGISTRATION_RULE))
    if (!target) {
      await e.reply("请输入正确的 QQ 号\n示例：#QQ注册时间3337194602", true)
      return true
    }

    try {
      const [data, bgData, baiduLatency] = await Promise.all([
        queryQQArchive(e.bot, target),
        getBgData(),
        getBaiduLatency()
      ])
      if (!data) {
        await e.reply("查询失败：ICQQ 未返回该账号的公开资料", true)
        return true
      }

      try {
        const yunzai = await getYunzaiVersion()
        const image = await puppeteer.screenshot("QQRegistrationTime", {
          tplFile,
          htmlDir,
          ...data,
          iconBase,
          bgData,
          baidu_latency: baiduLatency,
          yunzai_name: yunzai.name,
          yunzai_version: yunzai.version,
          deviceScaleFactor: 3,
          pageGotoParams: { waitUntil: "networkidle2" }
        })
        await e.reply(image, true)
      } catch (renderError) {
        logger.warn(`[JiuLi-Plugin][QQ账号档案] 图片渲染失败，已降级为文本：${renderError?.message || renderError}`)
        await e.reply([
          segment.image(data.avatar),
          `\n${archiveToText(data)}`
        ], true)
      }
      return true
    } catch (error) {
      logger.error("[JiuLi-Plugin][QQ账号档案] 查询失败：", error)
      await e.reply(`查询失败：${error?.message || error}`, true)
      return true
    }
  }
}

async function getLocalBg () {
  try {
    const files = (await fs.readdir(bgDir)).filter(file => /\.(?:jpe?g|png|webp)$/i.test(file))
    if (files.length) {
      const file = files[Math.floor(Math.random() * files.length)]
      const buffer = await fs.readFile(path.join(bgDir, file))
      const ext = path.extname(file).slice(1).toLowerCase()
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
      return `data:${mime};base64,${buffer.toString("base64")}`
    }
  } catch {}
  return ""
}

async function getBgData () {
  const url = "https://t.alcy.cc/mp"
  for (let index = 0; index < 3; index++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeout)
      const contentType = response.headers.get("content-type") || ""
      if (response.ok && contentType.startsWith("image/")) {
        const buffer = Buffer.from(await response.arrayBuffer())
        return `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`
      }
    } catch {}
    if (index < 2) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  return getLocalBg()
}

// 获取程序信息
function getYunzaiVersion () {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const name = pkg.name || 'unknown'
      const version = pkg.version || 'unknown'
      // 格式化名称: trss-yunzai -> Trss-Yunzai, miao-yunzai -> Miao-Yunzai
      const displayName = name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('-')
      return { name: displayName, version }
    }
  } catch (e) {}
  return { name: 'unknown', version: 'unknown' }
}