import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parse, stringify } from 'yaml'

const configFile = fileURLToPath(new URL('./config/PluginManager.yaml', import.meta.url))
const platforms = [['github', 'GitHub', 'github.com'], ['gitcode', 'GitCode', 'gitcode.com'], ['gitee', 'Gitee', 'gitee.com']]

/** 仅向已登录的锅巴面板提供配置，已有令牌不回传到浏览器。 */
export function createAuthConfigInfo(file = configFile) {
  function read() {
    if (!fs.existsSync(file)) return {}
    const value = parse(fs.readFileSync(file, 'utf8'))
    if (value == null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('配置文件格式不正确')
    return value
  }
  return {
    schemas: platforms.flatMap(([id, title]) => [
      { label: title, component: 'SOFT_GROUP_BEGIN' },
      { field: `${id}Username`, label: '用户名', component: 'Input', bottomHelpMessage: '填写该平台账户用户名；留空沿用安装器默认认证用户名。', componentProps: { autocomplete: 'off' } },
      { field: `${id}Token`, label: '访问令牌 / 密钥', component: 'InputPassword', bottomHelpMessage: '填写个人访问令牌（PAT），不是 SSH 私钥。已有令牌不回显，留空保留。仅用于 HTTPS 仓库认证。', componentProps: { autocomplete: 'new-password' } },
      { field: `${id}ClearToken`, label: '清除已保存密钥', component: 'Switch', bottomHelpMessage: '开启后保存可清除；清除与填写新密钥不能同时操作。' }
    ]),
    getConfigData() {
      const config = read()
      return Object.fromEntries(platforms.flatMap(([id, , host]) => [
        [`${id}Username`, config.auth?.[host]?.username || ''],
        [`${id}Token`, ''],
        [`${id}ClearToken`, false]
      ]))
    },
    setConfigData(data, { Result }) {
      let temporary
      try {
        const config = read()
        config.auth ||= {}
        for (const [id, , host] of platforms) {
          const current = { ...(config.auth[host] || {}) }
          const usernameKey = `${id}Username`, tokenKey = `${id}Token`
          if (Object.hasOwn(data, usernameKey)) {
            if (typeof data[usernameKey] !== 'string') throw new Error('用户名必须为文本')
            current.username = data[usernameKey].trim()
            if (/[\s\x00-\x1f\x7f]/.test(current.username)) throw new Error('用户名不能包含空白或控制字符')
          }
          const token = data[tokenKey]
          if (token !== undefined && typeof token !== 'string') throw new Error('密钥必须为文本')
          const clear = data[`${id}ClearToken`] === true
          if (clear && token?.trim()) throw new Error('不能同时清除和设置密钥')
          if (clear) current.token = ''
          else if (token?.trim()) {
            current.token = token.trim()
            if (/[\r\n\x00]/.test(current.token)) throw new Error('密钥不能包含换行或空字符')
          }
          config.auth[host] = current
        }
        fs.mkdirSync(path.dirname(file), { recursive: true })
        temporary = `${file}.${randomUUID()}.tmp`
        fs.writeFileSync(temporary, stringify(config), { mode: 0o600, flag: 'wx' })
        fs.renameSync(temporary, file)
        return Result.ok({}, '已保存，下次 HTTPS 安装时生效')
      } catch (error) {
        if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary)
        return Result.error(error.message)
      }
    }
  }
}

export function supportGuoba() {
  return {
    pluginInfo: {
      name: 'JiuLi-Plugin', title: 'JiuLi-Plugin',
      description: '玖璃工具集 · 插件安装器仓库认证配置',
      author: ['RainFoam0693', 'TimeRainStarSky'],
      authorLink: ['https://github.com/RainFoam0693', 'https://github.com/TimeRainStarSky'],
      link: 'https://github.com/RainFoam0693/JiuLi-Plugin',
      isV3: true, isV2: false, showInMenu: true,
      icon: 'mdi:puzzle-outline', iconColor: '#37b9ae'
    },
    configInfo: createAuthConfigInfo()
  }
}
