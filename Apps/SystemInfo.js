import { codeCardData } from "../Model/CardData.js"
import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import { AnsiUp } from "ansi_up"
import { getBaiduLatency } from "../Model/latency.js"
const ansi_up = new AnsiUp

const errorTips = "未使用脚本安装，此功能出错属于正常情况\n请参阅 JiuLi-Plugin 的 README.md"

let cmd = "fastfetch"
let cmds
let benchcmd = "bash <(curl -L bench.sh)"
let Running

if (process.platform == "win32") {
  cmds = `bash -c "${cmd}"`
  cmd = `bash -c "${cmd} --stdout"`
  benchcmd = `bash -c "${benchcmd}"`
} else {
  cmds = `${cmd} --pipe false`
  cmd = `${cmd} --pipe -l none`
}

export class SystemInfo extends plugin {
  constructor() {
    super({
      name: "系统信息",
      dsc: "系统信息",
      event: "message",
      priority: 10,
      rule: [
        {
          reg: "^#?系统信息$",
          fnc: "SystemInfo"
        },
        {
          reg: "^#?系统信息图片$",
          fnc: "SystemInfoPic"
        },
        {
          reg: "^#?系统测试$",
          fnc: "SystemBench"
        }
      ]
    })
  }

  async sendCommandResult(command, label, asImage) {
    const ret = await Bot.exec(command)
    if (ret.error) {
      logger.error(`${label}错误：${logger.red(ret.error)}`)
      await this.reply(`${label}错误：${ret.error}`, true)
      await this.reply(errorTips)
      return
    }

    const output = ret.stdout.trim()
    if (!asImage) {
      await this.reply(output, true)
      return
    }

    const data = codeCardData(command, ansi_up.ansi_to_html(output), await getBaiduLatency())
    const img = await puppeteer.screenshot("Code", data)
    await this.reply(img, true)
  }

  async SystemInfo() {
    await this.sendCommandResult(cmd, "系统信息", false)
  }

  async SystemInfoPic() {
    await this.sendCommandResult(cmds, "系统信息", true)
  }

  async SystemBench() {
    if (Running) {
      await this.reply("正在测试，请稍等……", true)
      return false
    }
    Running = true
    try {
      await this.reply("开始测试，请稍等……", true)
      await this.sendCommandResult(benchcmd, "系统测试", true)
    } finally {
      Running = false
    }
  }
}
