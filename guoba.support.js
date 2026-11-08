import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parse, stringify } from 'yaml'
import { PluginRepositories } from './Model/PluginRepositories.js'
import { normalizeCloneProxy } from './Model/CloneProxy.js'

const configFile = fileURLToPath(new URL('./config/PluginManager.yaml', import.meta.url))
const platforms = [['github', 'GitHub', 'github.com'], ['gitcode', 'GitCode', 'gitcode.com'], ['gitee', 'Gitee', 'gitee.com']]

/** 仅向已登录的锅巴面板提供配置，已有令牌不回传到浏览器。 */
export function createAuthConfigInfo(file = configFile, hostRoot = process.cwd()) {
  const pluginRoot = path.join(hostRoot, 'plugins')
  function repositoryOptions() {
    const options = []
    const hasGit = dir => {
      try { return !fs.lstatSync(path.join(dir, '.git')).isSymbolicLink() } catch { return false }
    }
    if (hasGit(hostRoot)) {
      let name = path.basename(hostRoot)
      try {
        const metadata = JSON.parse(fs.readFileSync(path.join(hostRoot, 'package.json'), 'utf8'))
        if (typeof metadata.name === 'string' && metadata.name.trim()) name = metadata.name.trim()
      } catch { /* 清单不完整时显示目录名称。 */ }
      options.push({ label: `${name}（机器人仓库）`, value: JSON.stringify(['core', '__core__']) })
    }
    let entries = []
    try { entries = fs.readdirSync(pluginRoot, { withFileTypes: true }) } catch { return options }
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && hasGit(path.join(pluginRoot, entry.name))) {
        options.push({ label: entry.name, value: JSON.stringify(['plugin', entry.name]) })
      }
    }
    return options
  }
  function read() {
    if (!fs.existsSync(file)) return {}
    const value = parse(fs.readFileSync(file, 'utf8'))
    if (value == null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('配置文件格式不正确')
    return value
  }
  return {
    get schemas() { return [
      { label: '安装方式', component: 'SOFT_GROUP_BEGIN' },
      { field: 'cloneProtocol', label: 'Git 克隆方式', component: 'Select', componentProps: { options: [{ label: 'HTTPS（用户名 / 访问令牌）', value: 'https' }, { label: 'SSH（本机 SSH 密钥）', value: 'ssh' }] }, bottomHelpMessage: '对后续新安装生效。SSH 使用机器人运行账号的本机密钥，不使用下方访问令牌；已有仓库地址不变。' },
      { field: 'httpsProxyEnabled', label: 'HTTPS 反代克隆', component: 'Switch', bottomHelpMessage: '开启后，确认可匿名访问的公开仓库优先使用 HTTPS 反代。私库认证及权限无法确认时仍直连，不向反代发送平台密钥。' },
      { field: 'httpsProxyUrl', label: 'HTTPS 反代地址', component: 'Input', componentProps: { placeholder: 'https://proxy.example/', autocomplete: 'off' }, bottomHelpMessage: '填写反代 URL 前缀，实际格式为：反代地址/https://github.com/作者/仓库.git。克隆成功后 origin 保留平台原始 HTTPS 地址。' },
      { label: '已有仓库协议（通用配置）', component: 'SOFT_GROUP_BEGIN' },
      { field: 'repositoryTarget', label: '选择仓库', component: 'Select', componentProps: { options: repositoryOptions(), allowClear: true, showSearch: true, optionFilterProp: 'label' }, bottomHelpMessage: '兼容原版锅巴。新增或删除仓库后刷新配置页；机器人仓库名称读取 package.json。' },
      { field: 'repositoryProtocol', label: '目标协议', component: 'Select', componentProps: { options: [{ label: 'HTTPS', value: 'https' }, { label: 'SSH', value: 'ssh' }] } },
      { field: 'repositoryApply', label: '应用仓库协议切换', component: 'Switch', bottomHelpMessage: '选好仓库与协议，开启后点击保存执行一次；不改变分支、代码或其他仓库。支持扩展页面的锅巴也可在插件仓库页直接操作。' },
      ...platforms.flatMap(([id, title]) => [
      { label: title, component: 'SOFT_GROUP_BEGIN' },
      { field: `${id}Username`, label: '用户名', component: 'Input', bottomHelpMessage: '填写该平台账户用户名；留空沿用安装器默认认证用户名。', componentProps: { autocomplete: 'off' } },
      { field: `${id}Token`, label: '访问令牌 / 密钥', component: 'InputPassword', bottomHelpMessage: '填写个人访问令牌（PAT），不是 SSH 私钥。已有令牌不回显，留空保留。仅用于 HTTPS 仓库认证。', componentProps: { autocomplete: 'new-password' } },
      { field: `${id}ClearToken`, label: '清除已保存密钥', component: 'Switch', bottomHelpMessage: '开启后保存可清除；清除与填写新密钥不能同时操作。' }
    ])] },
    getConfigData() {
      const config = read()
      return { httpsProxyEnabled: config.httpsProxyEnabled === true, httpsProxyUrl: config.httpsProxyUrl || '', repositoryTarget: '', repositoryProtocol: 'https', repositoryApply: false, cloneProtocol: config.cloneProtocol === 'ssh' ? 'ssh' : 'https', ...Object.fromEntries(platforms.flatMap(([id, , host]) => [
        [`${id}Username`, config.auth?.[host]?.username || ''],
        [`${id}Token`, ''],
        [`${id}ClearToken`, false]
      ])) }
    },
    async setConfigData(data, { Result }) {
      let temporary
      let repositories
      let target
      let switched = false
      try {
        const config = read()
        if (Object.hasOwn(data, 'cloneProtocol')) {
          if (!['https', 'ssh'].includes(data.cloneProtocol)) throw new Error('请选择 HTTPS 或 SSH 克隆方式')
          config.cloneProtocol = data.cloneProtocol
        }
        if (Object.hasOwn(data, 'httpsProxyEnabled')) {
          if (typeof data.httpsProxyEnabled !== 'boolean') throw new Error('HTTPS 反代开关必须为布尔值')
          config.httpsProxyEnabled = data.httpsProxyEnabled
        }
        if (Object.hasOwn(data, 'httpsProxyUrl')) config.httpsProxyUrl = normalizeCloneProxy(data.httpsProxyUrl)
        if (config.httpsProxyEnabled && !normalizeCloneProxy(config.httpsProxyUrl)) throw new Error('开启 HTTPS 反代克隆前，请填写反代地址')
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
        if (data.repositoryApply === true) {
          if (!['https', 'ssh'].includes(data.repositoryProtocol)) throw new Error('请选择要切换的仓库协议')
          if (!repositoryOptions().some(option => option.value === data.repositoryTarget)) throw new Error('请选择当前存在的 Git 仓库')
          const [kind, name] = JSON.parse(data.repositoryTarget)
          repositories = new PluginRepositories(pluginRoot, hostRoot)
          target = (await repositories.list()).plugins.find(item => item.kind === kind && item.name === name)
          if (!target?.supported) throw new Error('该仓库没有可切换的标准 origin 地址')
        }
        fs.mkdirSync(path.dirname(file), { recursive: true })
        temporary = `${file}.${randomUUID()}.tmp`
        fs.writeFileSync(temporary, stringify(config), { mode: 0o600, flag: 'wx' })
        // 先准备配置文件；仓库操作失败时不覆盖已保存的配置。
        if (target) {
          await repositories.switch(target.name, data.repositoryProtocol, target.version, target.kind)
          switched = true
        }
        fs.renameSync(temporary, file)
        return Result.ok({}, switched ? `${target.displayName || target.name} 已切换为 ${data.repositoryProtocol.toUpperCase()}，配置已保存` : '已保存，下次安装时生效')
      } catch (error) {
        if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary)
        const message = error.message.includes('Command failed') ? '仓库操作失败，请检查 Git 和目录权限' : error.message
        return Result.error(switched ? `仓库协议已切换，但配置保存失败：${message}` : message)
      } finally { repositories?.close() }
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
