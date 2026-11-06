import plugin from '../../../lib/plugins/plugin.js'
import { installCodeRewrite } from '../Model/CodeMessageRewrite.js'

export class CodeMessageRewrite extends plugin {
  constructor() {
    super({ name: '兑换码消息改写', dsc: '官发兑换码转原生 Markdown，野机保留转发', event: 'message', rule: [] })
    installCodeRewrite()
  }
}
