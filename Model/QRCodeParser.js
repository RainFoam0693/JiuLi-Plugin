import fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("zxing-wasm/reader/zxing_reader.wasm")
prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(wasmPath)
  }
})

const MAX_IMAGE_SIZE = 15 * 1024 * 1024
const MAX_INPUT_PIXELS = 50 * 1024 * 1024
const NORMALIZED_MAX_EDGE = 2400
const QUIET_ZONE = 32
const DOWNLOAD_TIMEOUT = 10000

const READER_OPTIONS = {
  formats: ["QRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDenoise: true,
  maxNumberOfSymbols: 32
}

export default class QRCodeParser {
  async parse (input) {
    try {
      const buffer = await this.toBuffer(input)
      let results = await this.decodeCandidates([{ name: "original", buffer }])

      if (!results.length) {
        for await (const candidates of this.buildFallbackStages(buffer)) {
          results = await this.decodeCandidates(candidates)
          if (results.length) break
        }
      }

      if (!results.length)
      { return { code: 1, msg: "未识别到有效二维码，请发送清晰原图或先裁剪二维码区域；过度美化的二维码可能不含可恢复数据", data: null, Result: [] } }

      const normalized = this.normalizeResults(results)

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

  async decodeCandidates (candidates) {
    const results = []

    for (const candidate of candidates) {
      try {
        const decoded = await readBarcodes(candidate.buffer, {
          ...READER_OPTIONS,
          tryDownscale: candidate.name === "original"
        })
        results.push(...decoded)
      } catch (error) {
        logger.debug?.(`[二维码解析] 候选 ${candidate.name} 解码失败：${error.message}`)
      }
    }

    return this.normalizeResults(results)
  }

  normalizeResults (results) {
    const seen = new Set()
    return results.filter(item => {
      if (typeof item.text !== "string" || !item.text || seen.has(item.text))
      { return false }

      seen.add(item.text)
      return true
    })
  }

  async * buildFallbackStages (buffer) {
    const base = sharp(buffer, {
      failOn: "none",
      limitInputPixels: MAX_INPUT_PIXELS
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .resize({
        width: NORMALIZED_MAX_EDGE,
        height: NORMALIZED_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true
      })

    const { data: normalized, info } = await base.png().toBuffer({ resolveWithObject: true })
    const enhanced = await sharp(normalized)
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1 })
      .png()
      .toBuffer()

    yield [
      { name: "normalized", buffer: normalized },
      { name: "enhanced", buffer: enhanced }
    ]

    const regions = this.createScanRegions(info.width, info.height)
    if (regions.length) {
      const candidates = []
      for (const [index, region] of regions.entries()) {
        const tile = await sharp(enhanced)
          .extract(region)
          .extend({
            top: QUIET_ZONE,
            bottom: QUIET_ZONE,
            left: QUIET_ZONE,
            right: QUIET_ZONE,
            background: "#ffffff"
          })
          .png()
          .toBuffer()
        candidates.push({ name: `region-${index + 1}`, buffer: tile })
      }
      yield candidates
    }

    const thresholds = []
    for (const value of [96, 128, 160, 192]) {
      thresholds.push({
        name: `threshold-${value}`,
        buffer: await sharp(enhanced).threshold(value).png().toBuffer()
      })
    }
    yield thresholds
  }

  createScanRegions (width, height) {
    if (Math.max(width, height) < 1000)
    { return [] }

    const regions = []
    if (height / width >= 1.5) {
      const regionHeight = Math.min(height, Math.ceil(width * 1.35))
      const positions = [0, Math.round((height - regionHeight) / 2), height - regionHeight]
      for (const top of positions)
      { regions.push({ left: 0, top, width, height: regionHeight }) }
    } else if (width / height >= 1.5) {
      const regionWidth = Math.min(width, Math.ceil(height * 1.35))
      const positions = [0, Math.round((width - regionWidth) / 2), width - regionWidth]
      for (const left of positions)
      { regions.push({ left, top: 0, width: regionWidth, height }) }
    } else {
      const regionWidth = Math.ceil(width * 0.7)
      const regionHeight = Math.ceil(height * 0.7)
      const left = width - regionWidth
      const top = height - regionHeight
      regions.push(
        { left: 0, top: 0, width: regionWidth, height: regionHeight },
        { left, top: 0, width: regionWidth, height: regionHeight },
        { left: 0, top, width: regionWidth, height: regionHeight },
        { left, top, width: regionWidth, height: regionHeight }
      )
    }

    return regions.filter((region, index) =>
      regions.findIndex(item => JSON.stringify(item) === JSON.stringify(region)) === index)
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
