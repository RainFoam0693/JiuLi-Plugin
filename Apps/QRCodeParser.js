import QRCodeParserModel from "../Model/QRCodeParser.js"

const parser = new QRCodeParserModel()

export class QRCodeParser extends plugin {
  constructor () {
    super({
      name: "二维码解析",
      dsc: "识别图片中的二维码内容",
      event: "message",
      priority: 10,
      rule: [
        {
          reg: "^#?(识别|解析)二维码$",
          fnc: "DetectQRCode"
        }
      ]
    })
  }

  async DetectQRCode (e) {
    const imageUrl = await this.getImageUrl(e)
    if (!imageUrl) {
      this.setContext("ParseQRCode")
      await this.reply("请发送二维码图片", true)
      return true
    }

    return this.ParseQRCode(e, imageUrl)
  }

  async ParseQRCode (e, imageUrl) {
    const event = e || this.e
    imageUrl ||= await this.getImageUrl(event)
    if (!imageUrl)
    { return false }

    this.finish("ParseQRCode")
    const result = await parser.parse(imageUrl)
    if (result.code !== 0) {
      await this.reply(result.msg, true)
      return true
    }

    const texts = [...new Set(result.Result.map(item => item.text))]
    const message = texts.length === 1
      ? `识别成功\n${texts[0]}`
      : `识别成功，共 ${texts.length} 个二维码\n${texts.map((text, index) => `『${index + 1}.』${text}`).join("\n")}`

    await this.reply(message, true)
    return true
  }

  async getImageUrl (e) {
    if (e?.img?.[0])
    { return e.img[0] }

    let reply
    try {
      if (e?.getReply) {
        reply = await e.getReply()
      } else if (e?.source) {
        if (e.group?.getChatHistory)
        { reply = (await e.group.getChatHistory(e.source.seq, 1)).pop() }
        else if (e.friend?.getChatHistory)
        { reply = (await e.friend.getChatHistory(e.source.time, 1)).pop() }
      }
    } catch (error) {
      logger.debug(`[二维码解析] 获取引用消息失败：${error.message}`)
    }

    const image = reply?.message?.find(item => item.type === "image")
    return image?.url || image?.file || null
  }
}
