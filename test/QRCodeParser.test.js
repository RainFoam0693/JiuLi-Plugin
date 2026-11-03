import assert from "node:assert/strict"
import test from "node:test"
import QRCode from "qrcode"
import sharp from "sharp"
import QRCodeParser from "../Model/QRCodeParser.js"

globalThis.logger = {
  mark () {},
  warn () {},
  debug () {}
}

const parser = new QRCodeParser()

test("识别清晰二维码", async () => {
  const image = await QRCode.toBuffer("JiuLi QR parser", { width: 320 })
  const result = await parser.parse(image)

  assert.equal(result.code, 0)
  assert.equal(result.data, "JiuLi QR parser")
})

test("从长截图中识别小尺寸低对比度二维码", async () => {
  const image = await QRCode.toBuffer("https://example.com/jiuli", {
    width: 300,
    margin: 2,
    color: { dark: "#555555", light: "#eeeeee" }
  })
  const screenshot = await sharp({
    create: { width: 1200, height: 2600, channels: 3, background: "#f8f8f8" }
  })
    .composite([{ input: image, left: 450, top: 1700 }])
    .jpeg({ quality: 72 })
    .toBuffer()
  class FallbackParser extends QRCodeParser {
    async decodeCandidates (candidates, onDamaged) {
      if (candidates.some(candidate => candidate.name === "original"))
      { return [] }
      return super.decodeCandidates(candidates, onDamaged)
    }
  }

  const result = await new FallbackParser().parse(screenshot)

  assert.equal(result.code, 0)
  assert.equal(result.data, "https://example.com/jiuli")
})

test("无法解码的装饰图不会产生误码", async () => {
  const image = await sharp({
    create: { width: 600, height: 800, channels: 3, background: "#dbeafe" }
  }).png().toBuffer()
  const result = await parser.parse(image)

  assert.equal(result.code, 1)
  assert.match(result.msg, /未识别到有效二维码/)
  assert.deepEqual(result.Result, [])
})

test("为嵌套截图生成二维重叠的小码扫描窗口", () => {
  const regions = parser.createDetailRegions(864, 1920)

  assert.equal(regions.length, 18)
  assert.ok(regions.some(region =>
    region.left <= 500 &&
    region.top <= 300 &&
    region.left + region.width >= 735 &&
    region.top + region.height >= 500))
})

test("通过二维局部窗口识别嵌套截图中的小码", async () => {
  const image = await QRCode.toBuffer("nested-small-qr", { width: 120, margin: 1 })
  const screenshot = await sharp({
    create: { width: 864, height: 1920, channels: 3, background: "#f8f8f8" }
  })
    .composite([{ input: image, left: 620, top: 280 }])
    .jpeg({ quality: 65 })
    .toBuffer()

  class DetailOnlyParser extends QRCodeParser {
    async decodeCandidates (candidates, onDamaged) {
      if (!candidates.some(candidate => candidate.name.startsWith("detail-")))
      { return [] }
      return super.decodeCandidates(candidates, onDamaged)
    }
  }

  const result = await new DetailOnlyParser().parse(screenshot)
  assert.equal(result.code, 0)
  assert.equal(result.data, "nested-small-qr")
})

test("区分已定位但校验失败的损坏二维码", async () => {
  const image = await QRCode.toBuffer("checksum-diagnostic-test", {
    width: 320,
    margin: 4,
    errorCorrectionLevel: "L"
  })
  const damaged = await sharp(image)
    .composite([{
      input: { create: { width: 70, height: 70, channels: 3, background: "#ffffff" } },
      left: 140,
      top: 140
    }])
    .png()
    .toBuffer()
  const result = await parser.parse(damaged)

  assert.equal(result.code, 1)
  assert.match(result.msg, /数据校验失败/)
  assert.deepEqual(result.Result, [])
})

test("ZXing 未命中时使用 ZBar WASM 兜底", async () => {
  const image = await QRCode.toBuffer("zbar-fallback", { width: 320 })

  class ZBarFallbackParser extends QRCodeParser {
    async decodeCandidates () {
      return []
    }
  }

  const result = await new ZBarFallbackParser().parse(image)
  assert.equal(result.code, 0)
  assert.equal(result.data, "zbar-fallback")
  assert.equal(result.Result[0].symbologyIdentifier, "ZBar")
})

test("ZXing 和 ZBar 未命中时使用 WeChatQRCode WASM 兜底", async () => {
  const image = await QRCode.toBuffer("wechat-fallback", { width: 320 })

  class WechatFallbackParser extends QRCodeParser {
    async decodeCandidates () {
      return []
    }

    async decodeWithZBar () {
      return []
    }
  }

  const result = await new WechatFallbackParser().parse(image)
  assert.equal(result.code, 0)
  assert.equal(result.data, "wechat-fallback")
  assert.equal(result.Result[0].symbologyIdentifier, "WeChatQRCode")
})
