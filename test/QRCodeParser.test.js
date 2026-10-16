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
  const image = await QRCode.toBuffer("TRSS QR parser", { width: 320 })
  const result = await parser.parse(image)

  assert.equal(result.code, 0)
  assert.equal(result.data, "TRSS QR parser")
})

test("从长截图中识别小尺寸低对比度二维码", async () => {
  const image = await QRCode.toBuffer("https://example.com/trss", {
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
    async decodeCandidates (candidates) {
      if (candidates.some(candidate => candidate.name === "original"))
      { return [] }
      return super.decodeCandidates(candidates)
    }
  }

  const result = await new FallbackParser().parse(screenshot)

  assert.equal(result.code, 0)
  assert.equal(result.data, "https://example.com/trss")
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
