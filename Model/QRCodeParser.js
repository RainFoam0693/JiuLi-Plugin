import fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("zxing-wasm/reader/zxing_reader.wasm")
prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(wasmPath)
  }
})

const MAX_IMAGE_SIZE = 15 * 1024 * 1024
const DOWNLOAD_TIMEOUT = 10000

export default class QRCodeParser {
  async parse (input) {
    try {
      const buffer = await this.toBuffer(input)
      const results = await readBarcodes(buffer, {
        formats: ["QRCode"],
        tryHarder: true
      })

      if (!results.length)
      { return { code: 1, msg: "未检测到二维码", data: null, Result: [] } }

      const normalized = results
        .filter(item => typeof item.text === "string")
        .map(item => ({ ...item, text: item.text }))

      if (!normalized.length)
      { return { code: 1, msg: "未检测到二维码", data: null, Result: [] } }

      logger.mark(`[二维码解析] 识别到 ${normalized.length} 个二维码`)
      return {
        code: 0,
        msg: "识别成功",
        data: normalized[0].text,
        Result: normalized
      }
    } catch (error) {
      logger.warn(`[二维码解析] ${error.stack || error.message}`)
      return {
        code: 2,
        msg: `二维码解析失败：${error.message || "未知错误"}`,
        data: null,
        Result: []
      }
    }
  }

  async toBuffer (input) {
    if (Buffer.isBuffer(input))
    { return this.checkSize(input) }

    if (typeof input !== "string" || !input.trim())
    { throw new Error("未提供二维码图片") }

    if (input.startsWith("base64://"))
    { return this.checkSize(Buffer.from(input.slice(9), "base64")) }

    if (input.startsWith("data:")) {
      const match = input.match(/^data:image\/[^;]+;base64,(.+)$/s)
      if (!match) throw new Error("图片 Base64 格式无效")
      return this.checkSize(Buffer.from(match[1], "base64"))
    }

    if (/^https?:\/\//i.test(input))
    { return this.download(input) }

    const filePath = input.startsWith("file://") ? fileURLToPath(input) : path.resolve(input)
    return this.checkSize(await fs.readFile(filePath))
  }

  async download (url) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow"
      })
      if (!response.ok)
      { throw new Error(`图片下载失败（HTTP ${response.status}）`) }

      const contentType = response.headers.get("content-type")?.toLowerCase() || ""
      if (contentType && !contentType.startsWith("image/") && !contentType.includes("octet-stream"))
      { throw new Error("链接返回的内容不是图片") }

      const contentLength = Number(response.headers.get("content-length"))
      if (contentLength > MAX_IMAGE_SIZE)
      { throw new Error("图片不能超过 15 MB") }

      return this.checkSize(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      if (error.name === "AbortError")
      { throw new Error("图片下载超时") }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  checkSize (buffer) {
    if (!buffer.length)
    { throw new Error("图片内容为空") }
    if (buffer.length > MAX_IMAGE_SIZE)
    { throw new Error("图片不能超过 15 MB") }
    return buffer
  }
}
