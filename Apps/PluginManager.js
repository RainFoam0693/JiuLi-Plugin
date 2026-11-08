import plugin from '../../../lib/plugins/plugin.js'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { execFile } = require('child_process')
import { fetchPluginIndex, repositoryUrl } from '../Model/PluginIndex.js'
import { detectRepositoryAccess } from '../Model/RepositoryAccess.js'
import { publicCloneProxy } from '../Model/CloneProxy.js'
import { buildSearchPages, buildMarketPage, buildInstalledPage } from '../Model/PluginSearch.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import { randomUUID } from 'node:crypto'
import { isOfficialQQBot, resolveInstallerCallback, managerMenu, listButtons, installedButtons, searchButtons, replyWithInstallerButtons } from '../Model/InstallerButtons.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse, stringify } from 'yaml'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, '..', 'config', 'PluginManager.yaml')

// 默认配置
const DEFAULT_CONFIG = {
  pluginsDir: path.join(process.cwd(), 'plugins'),
  npmRegistry: 'https://registry.npmmirror.com',
  protectedPlugins: ['example', 'genshin', 'system', 'other', 'adapter', 'JiuLi-Plugin'],
  gitTimeout: 60000,
  cloneProtocol: 'https',
  httpsProxyEnabled: false,
  httpsProxyUrl: '',
  auth: {
    'github.com': {
      username: '',
      token: ''
    },
    'gitee.com': {
      username: '',
      token: ''
    },
    'gitcode.com': {
      username: '',
      token: ''
    }
  }
}

// 初始化配置文件
function initConfigFile() {
  try {
    // 确保配置目录存在
    const configDir = path.dirname(CONFIG_FILE)
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }

    // 如果配置文件不存在，创建默认配置文件
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, stringify(DEFAULT_CONFIG), 'utf8')
      logger.mark(`[插件管理器] 已创建默认配置文件: ${CONFIG_FILE}`)
      return { ...DEFAULT_CONFIG }
    }

    // 读取现有配置文件
    const fileContent = fs.readFileSync(CONFIG_FILE, 'utf8')
    const userConfig = parse(fileContent)

    // 合并配置，用户配置覆盖默认配置
    let mergedConfig = { ...DEFAULT_CONFIG, ...userConfig }

    // 确保auth配置存在
    if (!mergedConfig.auth) {
      mergedConfig.auth = DEFAULT_CONFIG.auth
    } else {
      // 合并auth配置
      mergedConfig.auth = { ...DEFAULT_CONFIG.auth, ...mergedConfig.auth }
    }

    // 检查配置文件是否需要更新（添加新的配置项或迁移不兼容的旧路径）
    const pluginsDirMigrated = normalizePluginsDir(mergedConfig)
    const configNeedsUpdate = checkConfigUpdate(mergedConfig) || pluginsDirMigrated

    if (configNeedsUpdate) {
      // 备份原配置文件
      const backupFile = `${CONFIG_FILE}.backup.${Date.now()}`
      fs.copyFileSync(CONFIG_FILE, backupFile)
      logger.mark(`[插件管理器] 已备份原配置文件: ${backupFile}`)

      // 更新配置文件
      fs.writeFileSync(CONFIG_FILE, stringify(mergedConfig), 'utf8')
      logger.mark(`[插件管理器] 已更新配置文件: ${CONFIG_FILE}`)
    }

    logger.mark(`[插件管理器] 已加载配置文件: ${CONFIG_FILE}`)
    return mergedConfig
  } catch (error) {
    logger.error(`[插件管理器] 初始化配置文件失败: ${error.message}`)
    logger.mark(`[插件管理器] 使用默认配置`)
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * Windows 的盘符路径在 macOS/Linux 中会被当作相对路径，导致在项目内生成
 * "D:" 之类的错误目录。检测到旧配置时迁移到当前项目的 plugins 目录。
 */
function normalizePluginsDir(config) {
  if (process.platform === 'win32' || !/^[a-z]:[\\/]/i.test(config.pluginsDir || '')) {
    return false
  }

  logger.mark(`[插件管理器] 检测到不兼容的 Windows 插件路径，已改为: ${DEFAULT_CONFIG.pluginsDir}`)
  config.pluginsDir = DEFAULT_CONFIG.pluginsDir
  return true
}

// 检查配置是否需要更新
function checkConfigUpdate(config) {
  let needsUpdate = false

  // 检查是否有新增的配置项
  for (const key in DEFAULT_CONFIG) {
    if (!(key in config)) {
      config[key] = DEFAULT_CONFIG[key]
      needsUpdate = true
    }
  }

  // 检查auth配置是否有新增的平台
  if (config.auth) {
    for (const platform in DEFAULT_CONFIG.auth) {
      if (!(platform in config.auth)) {
        config.auth[platform] = DEFAULT_CONFIG.auth[platform]
        needsUpdate = true
      }
    }
  }

  return needsUpdate
}

// 初始化配置
let CONFIG = initConfigFile()
let lastConfigModified = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : 0

/** 获取认证配置 */
const getAuthConfig = () => {
  checkConfigFileChanges()
  return CONFIG.auth || {}
}

/** 检查配置文件是否有变化，如果有则重新加载 */
function checkConfigFileChanges() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return

    const currentModified = fs.statSync(CONFIG_FILE).mtimeMs
    if (currentModified !== lastConfigModified) {
      logger.mark('[插件管理器] 检测到配置文件变化，重新加载配置')
      CONFIG = initConfigFile()
      lastConfigModified = currentModified
    }
  } catch (error) {
    logger.error(`[插件管理器] 检查配置文件变化失败: ${error.message}`)
  }
}

/** 手动重新加载配置文件 */
function reloadConfig() {
  try {
    logger.mark('[插件管理器] 手动重新加载配置文件')
    CONFIG = initConfigFile()
    lastConfigModified = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : 0
    return true
  } catch (error) {
    logger.error(`[插件管理器] 重新加载配置文件失败: ${error.message}`)
    return false
  }
}

export class PluginManager extends plugin {
  constructor () {
    super({
      name: '插件管理器',
      dsc: '基于 Markdown 索引的插件安装与管理',
      event: 'message',
      priority: -1,
      rule: [
        { reg: '^#JLPM:[a-f0-9]{24}$', fnc: 'handleInstallerCallback' },
        { reg: '^#插件安装器帮助$', fnc: 'installerHelp' },
        { reg: '^#?切换\\s*([Ss][Ss][Hh]|[Hh][Tt][Tt][Pp][Ss])\\s*克隆$', fnc: 'switchCloneProtocol', permission: 'master' },
        { reg: '^#插件(列表|市场|大全)(\\s*\\d+)?$', fnc: 'showPluginList' },
        { reg: '^#安装插件\\s*(https?://|git@).+$', fnc: 'installPluginFromUrl' },
        { reg: '^#安装插件(.*)$', fnc: 'installPluginByName' },
        { reg: '^#已安装插件(列表)?(\\s*\\d+)?$', fnc: 'showInstalledPlugins' },
        { reg: '^#插件强制(切换|换)分支(.*)$', fnc: 'forceSwitchPluginBranch' },
        { reg: '^#插件(切换|换)分支(.*)$', fnc: 'switchPluginBranch' },
        { reg: '^#(删除|卸载)插件(.*)$', fnc: 'uninstallPlugin' },
        { reg: '^#搜索插件(.*)$', fnc: 'searchPlugin' },
        { reg: '^#搜索(github|gitcode)?仓库(.+)$', fnc: 'searchRepository' },
        { reg: '^#[Gg][Ii][Tt][Hh][Uu][Bb]搜索(.+)$', fnc: 'searchRepositoryShort' },
        { reg: '^#[Gg][Ii][Tt][Cc][Oo][Dd][Ee]搜索(.+)$', fnc: 'searchRepositoryShort' },
        { reg: '^#插件管理器(重置|初始化)(配置)?$', fnc: 'resetConfig' },
        { reg: '^#插件管理器重载配置$', fnc: 'reloadConfigCommand' }
      ]
    })
  }

  /** 与锅巴共用默认克隆方式，只修改协议字段，保留密钥和其他配置。 */
  async switchCloneProtocol(e) {
    if (!this.checkPermission(e)) return false
    const match = /^#?切换\s*(ssh|https)\s*克隆$/i.exec(e.msg || '')
    if (!match) return false
    const protocol = match[1].toLowerCase()
    let temporary
    try {
      const saved = fs.existsSync(CONFIG_FILE) ? parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : { ...DEFAULT_CONFIG }
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('配置文件格式不正确')
      saved.cloneProtocol = protocol
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
      temporary = `${CONFIG_FILE}.${randomUUID()}.tmp`
      fs.writeFileSync(temporary, stringify(saved), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, CONFIG_FILE)
      CONFIG = { ...CONFIG, ...saved }
      lastConfigModified = fs.statSync(CONFIG_FILE).mtimeMs
    } catch (error) {
      if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary)
      logger.error(`[插件管理器] 切换克隆方式失败：${error.message}`)
      return e.reply('切换失败，请检查插件配置文件格式与写入权限')
    }
    return e.reply(`默认克隆方式已切换为 ${protocol.toUpperCase()}，下次新安装生效。`)
  }

  /** 原生按钮回调经 QQBot 的 INTERACTION_CREATE 事件进入，校验后调用业务方法。 */
  async handleInstallerCallback(e) {
    const action = resolveInstallerCallback(e)
    if (!action) return e.reply('按钮已失效或不属于当前会话，请重新搜索或打开插件市场。')
    // 此次授权来自已验证主人的同一 openid 会话，不修改全局主人配置。
    const request = { ...e, isMaster: true }
    switch (action.type) {
      case 'list': return this.showPluginList({ ...request, msg: `#插件列表${action.page}` })
      case 'installed': return this.showInstalledPlugins({ ...request, msg: `#已安装插件${action.page || 1}` })
      case 'search': return this.searchPlugin({ ...request, msg: `#搜索插件${action.keyword}` }, action.page)
      case 'install': return this.installPluginFromUrl({ ...request, msg: `#安装插件 ${action.url}` })
      case 'help': return this.installerHelp(request)
      default: return false
    }
  }

  /** 官机回调不一定带 group/friend 转发对象，不能依赖 makeForwardMsg。 */
  async sendManagerEntries(e, entries) {
    if (isOfficialQQBot(e)) {
      for (let i = 0; i < entries.length; i += 6) {
        await e.reply(entries.slice(i, i + 6).map(item => item.message).join('\n\n'))
      }
      return true
    }
    const target = e.group || e.friend
    if (typeof target?.makeForwardMsg === 'function') return e.reply(await target.makeForwardMsg(entries))
    for (const item of entries) await e.reply(item.message)
    return true
  }

  async installerHelp(e) {
    if (!this.checkPermission(e)) return false
    return replyWithInstallerButtons(e,
      '插件安装器\n#搜索插件关键词：查找插件\n#插件列表：查看市场\n#已安装插件：查看本地插件\n#切换ssh克隆 / #切换https克隆：切换默认克隆方式\n#安装插件名称或仓库地址：安装插件\n官机可点击搜索卡片下的安装按钮，按钮仅当前主人可用，20 分钟后失效。')
  }

  /* ================= 插件列表识别与安装逻辑 ================= */

  /**
   * 处理 #安装插件 [名字]
   * 逻辑：从三个 Markdown 索引识别插件名，并自动处理私库认证
   */
  async installPluginByName(e) {
    if (!this.checkPermission(e)) return false

    try {
      // 获取指令中的插件名和可选分支：插件名,分支名
      const { target: name, branch, hasSeparator } = this.parseInstallInput(
        e.msg.replace(/#安装插件/, '').trim()
      )

      if (!name) return e.reply('请提供插件名称或 Git 链接')
      // 零宽字符可能使地址规则未命中；规范化后重新交给 URL 安装逻辑。
      if (/^(https?:\/\/|git@)/.test(name)) {
        return this.installPluginFromUrl({ ...e, msg: `#安装插件 ${name}${hasSeparator ? `,${branch}` : ''}` })
      }
      if (hasSeparator && !branch) return e.reply('请在逗号后提供要克隆的分支名称')
      if (/[\x00-\x1F\x7F]/.test(branch)) return e.reply('分支名称不能包含控制字符')

      // 1. 获取远程插件列表
      const list = await this.fetchPluginList()

      // 2. 检查插件名是否存在（支持 pathname 或 pluginname 匹配）
      const target = list.find(i => [i.pathname, i.pluginname, ...(i.aliases || [])].some(value => value.toLowerCase() === name.toLowerCase()))

      if (!target) {
          return await e.reply(`市场中未找到插件：${name}`)
      }

      // 3. 构造安装指令分发给 URL安装逻辑
      e.msg = `#安装插件 ${target.url}`
      return await this.installPluginFromUrl(e, branch)
    } catch (error) {
      logger.error(`[插件管理器] 安装插件失败: ${error.message}`)
      return e.reply(`安装插件时发生错误: ${error.message}`)
    }
  }

  async installPluginFromUrl(e, branch = null) {
    if (!this.checkPermission(e)) return false

    try {
      const input = e.msg.replace(/#安装插件/, '').trim()
      let rawUrl = input
      let effectiveBranch = branch || ''

      // 直接通过 URL 安装时，从地址末尾解析可选分支；名称安装已显式传入 branch。
      if (branch === null) {
        const parsed = this.parseInstallInput(input)
        rawUrl = parsed.target
        effectiveBranch = parsed.branch

        if (parsed.hasSeparator && !effectiveBranch) {
          return e.reply('请在逗号后提供要克隆的分支名称')
        }
      }

      if (/[\x00-\x1F\x7F]/.test(effectiveBranch)) {
        return e.reply('分支名称不能包含控制字符')
      }

      checkConfigFileChanges()
      const ssh = /^git@([^:]+):(.+)$/.exec(rawUrl)
      const validated = repositoryUrl(ssh ? `https://${ssh[1]}/${ssh[2]}` : rawUrl)
      // 统一按锅巴选择的协议构造地址，名称安装和粘贴地址使用同一配置。
      const repository = new URL(validated.url)
      rawUrl = CONFIG.cloneProtocol === 'ssh'
        ? `git@${repository.hostname}:${repository.pathname.slice(1)}.git`
        : `${validated.url}.git`
      const cleanUrl = validated.url
      const pluginName = this.extractPluginNameFromUrl(cleanUrl)
      const targetPath = path.join(CONFIG.pluginsDir, pluginName)

      if (fs.existsSync(targetPath)) {
        return e.reply(`[${pluginName}] 已存在`)
      }

      let finalUrl = rawUrl
      const host = repository.hostname === 'gitcode.net' ? 'gitcode.com' : repository.hostname
      const auth = getAuthConfig()[host] || {}
      const access = await detectRepositoryAccess(cleanUrl, auth)
      if (access === 'authenticated') {
        finalUrl = this.buildOAuth2AuthUrl(`${cleanUrl}.git`)
        if (!finalUrl) return e.reply('仓库需要认证，请先在锅巴中配置对应平台的用户名和访问令牌')
        await e.reply('该仓库需要认证，已自动切换为 HTTPS，使用已配置的用户名和令牌。')
      }

      const proxyUrl = publicCloneProxy(`${cleanUrl}.git`, CONFIG, access)
      if (proxyUrl) {
        finalUrl = proxyUrl
        await e.reply('公开仓库使用 HTTPS 反代克隆。')
      }

      await e.reply(effectiveBranch
        ? `[${pluginName}] 开始下载分支 ${effectiveBranch}...`
        : `[${pluginName}] 开始下载...`)
      let result = await this.gitClone(finalUrl, targetPath, effectiveBranch)

      // 访问性无法确认且首次克隆失败时，允许使用已配置令牌做一次 HTTPS 重试。
      if (result.error && access === 'unknown' && auth.token && auth.token !== '秘钥') {
        const authUrl = this.buildOAuth2AuthUrl(`${cleanUrl}.git`)
        if (authUrl) {
          await e.reply('首次克隆失败，尝试已配置的 HTTPS 认证；这不代表已确认仓库为私库。')
          result = await this.gitClone(authUrl, targetPath, effectiveBranch)
        }
      }

      if (result.error) {
        return e.reply(`安装失败：\n${this.maskSecret(result.stderr || result.error.message)}`)
      }

      if (proxyUrl) {
        const restored = await this.runCommand('git', ['remote', 'set-url', 'origin', `${cleanUrl}.git`], { cwd: targetPath })
        if (restored.error) return e.reply(`[${pluginName}] 已下载，但设置平台原始远端地址失败，请检查 Git 配置权限后再安装依赖。`)
      }
      return await this.installDependencies(pluginName, e)
    } catch (error) {
      logger.error(`[插件管理器] 从URL安装插件失败: ${error.message}`)
      return e.reply(`安装插件时发生错误: ${error.message}`)
    }
  }

  /* ================= 工具函数 ================= */

  /**
   * 解析“安装目标,分支名”，兼容中文逗号及聊天复制带入的零宽字符。
   */
  parseInstallInput(input) {
    input = String(input).replace(/[\u200B-\u200F\u2060\uFEFF]/g, '').trim()
    const separatorIndex = input.search(/[,，]/)
    return {
      target: (separatorIndex === -1 ? input : input.slice(0, separatorIndex)).trim(),
      branch: separatorIndex === -1 ? '' : input.slice(separatorIndex + 1).trim(),
      hasSeparator: separatorIndex !== -1
    }
  }

  /**
   * 检查用户权限
   */
  checkPermission(e) {
    if (!e.isMaster) {
      e.reply('只有管理员才能使用此命令')
      return false
    }
    return true
  }

  /**
   * 从URL中提取插件名
   */
  extractPluginNameFromUrl(url) {
    return url.split('/').pop().replace(/\.git$/, '')
  }

  /**
   * 检查是否为私库链接
   */
  isPrivateRepo(url) {
    return /gitcode\.(com|net)|github\.com|gitee\.com/i.test(url)
  }

  /**
   * 构建 HTTPS 认证地址，支持按平台配置用户名与个人访问令牌
   */
  buildOAuth2AuthUrl(url) {
    try {
      const u = new URL(url)
      const hostname = u.hostname.toLowerCase().replace('www.', '')
      const host = hostname === 'gitcode.net' ? 'gitcode.com' : hostname
      const authConfig = getAuthConfig()
      const cfg = authConfig[host]
      if (!cfg?.token || cfg.token === '秘钥') return null
      const username = cfg.username?.trim() || 'oauth2'
      return `https://${encodeURIComponent(username)}:${encodeURIComponent(cfg.token)}@${u.host}${u.pathname}${u.pathname.endsWith('.git') ? '' : '.git'}`
    } catch (error) {
      logger.error(`[插件管理器] 构建OAuth2认证URL失败: ${error.message}`)
      return null
    }
  }

  /**
   * Git克隆操作
   */
  async gitClone(url, targetPath, branch = '') {
    try {
      // 确保目标目录存在
      const parentDir = path.dirname(targetPath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      // 彻底解决 "could not read Username"：
      // 1. -c credential.helper='' 禁用系统弹出的凭据管理器
      // 2. GIT_TERMINAL_PROMPT=0 禁用终端交互询问
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      if (url.startsWith('https://')) {
        const remote = new URL(url)
        if (remote.username || remote.password) {
          const credentials = `${decodeURIComponent(remote.username)}:${decodeURIComponent(remote.password)}`
          remote.username = ''; remote.password = ''
          url = remote.href
          // 凭据仅经子进程环境传递，避免写入 origin 或出现在 Git 错误命令中。
          const inheritedCount = Number(env.GIT_CONFIG_COUNT || 0)
          if (!Number.isInteger(inheritedCount) || inheritedCount < 0 || inheritedCount > 100) throw new Error('Git 环境配置数量无效')
          env.GIT_CONFIG_COUNT = String(inheritedCount + 1)
          env[`GIT_CONFIG_KEY_${inheritedCount}`] = `http.${url}.extraHeader`
          env[`GIT_CONFIG_VALUE_${inheritedCount}`] = `Authorization: Basic ${Buffer.from(credentials).toString('base64')}`
        }
      }
      const args = ['-c', 'credential.helper=', 'clone', '--depth=1']
      if (branch) args.push('--branch', branch, '--single-branch')
      args.push(url, targetPath)

      return await this.runCommand('git', args, {
        env,
        timeout: CONFIG.gitTimeout
      })
    } catch (error) {
      logger.error(`[插件管理器] Git克隆失败: ${error.message}`)
      return { error }
    }
  }

  /**
   * 安装插件依赖
   */
  async installDependencies(name, e) {
    try {
      await e.reply(`[${name}] 下载成功，正在安装依赖环境...`)
      const pluginPath = path.join(CONFIG.pluginsDir, name)

      // 检查是否存在package.json
      const packageJsonPath = path.join(pluginPath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        return e.reply(`[${name}] 没有检测到package.json，跳过依赖安装`)
      }

      const res = await this.runCommand(this.getPnpmCommand(), ['install', `--registry=${CONFIG.npmRegistry}`], {
        cwd: pluginPath,
        timeout: CONFIG.gitTimeout
      })

      if (res.error) {
        logger.error(`[插件管理器] 依赖安装失败: ${res.stderr}`)
        return e.reply(`[${name}] 依赖安装失败，请手动进入目录执行 pnpm i\n错误信息: ${res.stderr}`)
      }

      return replyWithInstallerButtons(e, `[${name}] 安装成功，重启后生效`)
    } catch (error) {
      logger.error(`[插件管理器] 安装依赖失败: ${error.message}`)
      return e.reply(`[${name}] 依赖安装过程中发生错误: ${error.message}`)
    }
  }

  /**
   * 隐藏敏感信息
   */
  maskSecret(str = '') {
    return str.replace(/:[^@]+@/g, ':***@')
  }

  /* ================= 原有展示与搜索逻辑 (保持原样) ================= */

  async showPluginList(e) {
    if (!this.checkPermission(e)) return false

    try {
      const pluginsList = await this.fetchPluginList()
      if (!pluginsList || pluginsList.length === 0) {
        return e.reply('插件列表为空或获取失败')
      }

      const page = Math.max(1, Number(e.msg.match(/\d+$/)?.[0] || 1))
      const total = Math.ceil(pluginsList.length / 6)
      const data = buildMarketPage(pluginsList, page)
      if (!data) return e.reply(`共 ${total} 页，请使用 #插件列表页码`)
      const htmlDir = fileURLToPath(new URL('../Resources/PluginSearch/', import.meta.url))
      let image
      try {
        image = await puppeteer.screenshot('JiuLi-Plugin/PluginMarket', {
          ...data, tplFile: path.join(htmlDir, 'PluginSearch.html'), htmlDir,
          saveId: randomUUID(), imgType: 'png', deviceScaleFactor: 2,
          pageGotoParams: { waitUntil: 'load' }
        })
        if (!image) throw new Error('渲染服务未返回图片')
      } catch (error) {
        logger.error(`[插件管理器] 市场图片生成失败：${error.message}`)
        await e.reply('市场图片生成失败，暂以文字显示。')
        const entries = pluginsList.slice(data.start - 1, data.end).map(item => ({
          user_id: e.self_id,
          message: `${item.pluginname}\n${item.describe || '暂无简介'}\n#安装插件 ${item.pathname}`
        }))
        await this.sendManagerEntries(e, entries)
        return replyWithInstallerButtons(e, `插件市场 · 第 ${page}/${total} 页`, listButtons(e, page, total))
      }
      const installs = searchButtons(e, data, pluginsList, '').slice(0, Math.ceil(data.plugins.length / 2))
      return replyWithInstallerButtons(e, image, [...installs, ...listButtons(e, page, total)])

    } catch (error) {
      logger.error(`[插件管理器] 获取插件列表失败: ${error.message}`)
      e.reply(`获取插件列表失败: ${error.message}`)
    }
  }

  async searchPlugin(e, searchPage = 1) {
    if (!this.checkPermission(e)) return false

    try {
      const match = e.msg.match(/^#搜索插件(.*)$/)
      if (!match) return false

      const keyword = match[1].trim()
      if (!keyword) return e.reply('请提供搜索关键词')

      const list = await this.fetchPluginList()
      const query = keyword.toLowerCase()
      const result = list.filter(item =>
        [item.pluginname, item.author, item.describe, item.pathname, ...(item.aliases || [])]
          .some(value => value?.toLowerCase().includes(query))
      )

      if (result.length === 0) return e.reply(`未搜索到包含 "${keyword}" 的插件！`)

      const htmlDir = fileURLToPath(new URL('../Resources/PluginSearch/', import.meta.url))
      let images
      try {
        images = []
        const pages = buildSearchPages(result, keyword)
        const requestedPage = Math.max(1, Math.min(pages.length, Number(searchPage) || 1))
        for (const data of pages.filter(data => !isOfficialQQBot(e) || data.page === requestedPage)) {
          const image = await puppeteer.screenshot('JiuLi-Plugin/PluginSearch', {
            ...data,
            tplFile: path.join(htmlDir, 'PluginSearch.html'),
            htmlDir,
            saveId: `${randomUUID()}-${data.page}`,
            imgType: 'png',
            deviceScaleFactor: 2,
            pageGotoParams: { waitUntil: 'load' }
          })
          if (!image) throw new Error('渲染服务未返回图片')
          images.push({ image, data })
        }
      } catch (error) {
        logger.error(`[插件管理器] 搜索结果图片渲染失败：${error.message}`)
        await e.reply('搜索图片生成失败，已改为文字结果。')
        const messages = result.slice(0, 30).map(item => ({
          user_id: e.self_id,
          message: `插件名称: ${item.pluginname}\n作者: ${item.author || '未知'}\n简介: ${item.describe || '无'}\nURL: ${item.url}\n安装指令: #安装插件 ${item.pathname}`
        }))
        await this.sendManagerEntries(e, messages)
        if (isOfficialQQBot(e)) return replyWithInstallerButtons(e, '插件安装器 · 搜索结果已以文字显示')
        return true
      }
      for (const { image, data } of images) await replyWithInstallerButtons(e, image, searchButtons(e, data, result, keyword))

    } catch (error) {
      logger.error(`[插件管理器] 搜索插件失败: ${error.message}`)
      e.reply(`搜索插件失败: ${error.message}`)
    }
  }

  async showInstalledPlugins(e) {
    if (!this.checkPermission(e)) return false

    try {
      // 确保插件目录存在
      if (!fs.existsSync(CONFIG.pluginsDir)) {
        return e.reply('插件目录不存在')
      }

      const files = fs.readdirSync(CONFIG.pluginsDir, { withFileTypes: true })
      const directories = files
        .filter(d => d.isDirectory() && !CONFIG.protectedPlugins.includes(d.name))
        .map(d => d.name)

      if (directories.length === 0) {
        return e.reply('暂无已安装的插件')
      }

      // 索引不可用时仍展示本地插件；优先用索引补充名称、作者和简介。
      const cloudPluginsList = await this.fetchPluginList().catch(error => {
        logger.warn(`[插件管理器] 索引不可用，改用本地插件信息：${error.message}`)
        return []
      })
      const entries = directories.sort((a, b) => a.localeCompare(b)).map(dirName => {
        const remote = cloudPluginsList.find(item =>
          [item.pathname, ...(item.aliases || [])].some(name => name.toLowerCase() === dirName.toLowerCase()))
        let metadata = {}
        try { metadata = JSON.parse(fs.readFileSync(path.join(CONFIG.pluginsDir, dirName, 'package.json'), 'utf8')) } catch {}
        const author = typeof metadata.author === 'string' ? metadata.author : metadata.author?.name
        return {
          pathname: dirName,
          pluginname: remote?.pluginname || metadata.name || dirName,
          author: remote?.author || author || '未知作者',
          describe: remote?.describe || metadata.description || '本地插件，暂无简介。',
          category: remote?.category || '本地插件'
        }
      })
      const page = Math.max(1, Number(e.msg?.match(/\d+$/)?.[0] || 1))
      const data = buildInstalledPage(entries, page)
      const total = Math.ceil(entries.length / 6)
      if (!data) return e.reply(`共 ${total} 页，请使用 #已安装插件页码`)
      const htmlDir = fileURLToPath(new URL('../Resources/PluginSearch/', import.meta.url))
      let image
      try {
        image = await puppeteer.screenshot('JiuLi-Plugin/InstalledPlugins', {
          ...data, tplFile: path.join(htmlDir, 'PluginSearch.html'), htmlDir,
          saveId: randomUUID(), imgType: 'png', deviceScaleFactor: 2,
          pageGotoParams: { waitUntil: 'load' }
        })
        if (!image) throw new Error('渲染服务未返回图片')
      } catch (error) {
        logger.error(`[插件管理器] 已安装插件图片生成失败：${error.message}`)
        await e.reply('图片生成失败，暂以文字显示。')
        const rows = entries.slice(data.start - 1, data.end).map(item => ({
          user_id: e.self_id, message: `${item.pluginname}\n目录：${item.pathname}\n${item.describe}\n#卸载插件 ${item.pathname}`
        }))
        await this.sendManagerEntries(e, rows)
        return replyWithInstallerButtons(e, `已安装插件 · 第 ${page}/${total} 页`, installedButtons(e, page, total))
      }
      return replyWithInstallerButtons(e, image, installedButtons(e, page, total))

    } catch (error) {
      logger.error(`[插件管理器] 获取已安装插件失败: ${error.message}`)
      e.reply(`获取已安装插件失败: ${error.message}`)
    }
  }

  /**
   * 将已安装插件安全切换到指定的 origin 远端分支。
   * 指令：#插件换分支插件名,分支名
   */
  async switchPluginBranch(e, force = false) {
    if (!this.checkPermission(e)) return false

    try {
      const commandPattern = force
        ? /^#插件强制(?:切换|换)分支/
        : /^#插件(?:切换|换)分支/
      const input = e.msg.replace(commandPattern, '').trim()
      const { target: name, branch, hasSeparator } = this.parseInstallInput(input)

      if (!name || !hasSeparator || !branch) {
        return e.reply(force
          ? '用法：#插件强制切换分支插件名,分支名'
          : '用法：#插件换分支插件名,分支名')
      }
      if (/[\\/\x00-\x1F\x7F]/.test(name) || name === '.' || name === '..' || path.basename(name) !== name) {
        return e.reply('插件名称格式不正确')
      }
      if (CONFIG.protectedPlugins.includes(name)) {
        return e.reply('核心组件不支持自动换分支')
      }

      const branchCheck = await this.runCommand('git', ['check-ref-format', '--branch', branch], {
        timeout: CONFIG.gitTimeout
      })
      if (branchCheck.error) return e.reply(`分支名称无效：${branch}`)

      const pluginsRoot = path.resolve(CONFIG.pluginsDir)
      const pluginPath = path.resolve(pluginsRoot, name)
      const relativePath = path.relative(pluginsRoot, pluginPath)
      if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
        return e.reply('插件路径不安全，已拒绝操作')
      }
      if (!fs.existsSync(pluginPath) || !fs.statSync(pluginPath).isDirectory()) {
        return e.reply(`插件 [${name}] 不存在`)
      }

      const realPluginsRoot = fs.realpathSync(pluginsRoot)
      const realPluginPath = fs.realpathSync(pluginPath)
      const realRelativePath = path.relative(realPluginsRoot, realPluginPath)
      if (!realRelativePath || realRelativePath.startsWith(`..${path.sep}`) || realRelativePath === '..' || path.isAbsolute(realRelativePath)) {
        return e.reply('插件路径指向插件目录外，已拒绝操作')
      }
      if (!fs.existsSync(path.join(realPluginPath, '.git'))) {
        return e.reply(`插件 [${name}] 不是 Git 仓库，无法自动换分支`)
      }

      const gitOptions = {
        cwd: realPluginPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: CONFIG.gitTimeout
      }
      const runGit = args => this.runCommand('git', args, gitOptions)

      const topLevel = await runGit(['rev-parse', '--show-toplevel'])
      if (topLevel.error) return e.reply(`插件 [${name}] 不是有效的 Git 仓库`)
      const realTopLevel = fs.realpathSync(topLevel.stdout.trim())
      if (realTopLevel !== realPluginPath) {
        return e.reply(`插件 [${name}] 不是独立的 Git 仓库，无法自动换分支`)
      }

      const status = await runGit(['status', '--porcelain=v1', '--untracked-files=all'])
      if (status.error) {
        return e.reply(`检查插件状态失败：${this.maskSecret(status.stderr || status.error.message)}`)
      }
      if (status.stdout.trim()) {
        const changedFiles = status.stdout.trim().split('\n').slice(0, 5).join('\n')
        if (!force) {
          return e.reply(`插件 [${name}] 存在未提交或未跟踪的改动，请先处理后再换分支：\n${changedFiles}`)
        }
        await e.reply(`警告：即将强制切换插件 [${name}]，以下 staged/unstaged 改动将被丢弃；与目标分支冲突的未跟踪文件也可能被移除：\n${changedFiles}`)
      }

      const origin = await runGit(['remote', 'get-url', 'origin'])
      if (origin.error) return e.reply(`插件 [${name}] 未配置 origin 远端`)

      await e.reply(`正在将插件 [${name}] 切换到分支 [${branch}]...`)
      const shallowResult = await runGit(['rev-parse', '--is-shallow-repository'])
      const isShallow = !shallowResult.error && shallowResult.stdout.trim() === 'true'
      const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`
      const fetchArgs = isShallow
        ? ['fetch', '--depth=1', '--no-tags', 'origin', refspec]
        : ['fetch', '--no-tags', 'origin', refspec]
      const fetchResult = await runGit(fetchArgs)
      if (fetchResult.error) {
        return e.reply(this.formatRemoteFetchError(branch, fetchResult))
      }

      const remoteRef = `refs/remotes/origin/${branch}`
      const remoteTrackingBranch = await runGit(['show-ref', '--verify', '--quiet', remoteRef])
      const remoteCommit = await runGit(['rev-parse', '--verify', `${remoteRef}^{commit}`])
      if (remoteTrackingBranch.error || remoteCommit.error) {
        return e.reply(`远端分支 [${branch}] 已获取，但未生成有效的远端跟踪引用`)
      }

      // 单分支 clone 的 remote.origin.fetch 只包含初始分支；补充映射后 Git 才会
      // 将 origin/<branch> 识别为可跟踪的远端分支。
      const fetchConfig = await runGit(['config', '--get-all', 'remote.origin.fetch'])
      const configuredRefspecs = (fetchConfig.stdout || '').split('\n').map(item => item.trim()).filter(Boolean)
      const targetRefspec = `refs/heads/${branch}:refs/remotes/origin/${branch}`
      const hasTargetRefspec = configuredRefspecs.some(item => {
        const normalized = item.replace(/^\+/, '')
        return normalized === targetRefspec || normalized === 'refs/heads/*:refs/remotes/origin/*'
      })

      if (!hasTargetRefspec) {
        const addRefspec = await runGit(['config', '--add', 'remote.origin.fetch', `+${targetRefspec}`])
        if (addRefspec.error) {
          return e.reply(`登记远端分支跟踪配置失败：${this.maskSecret(addRefspec.stderr || addRefspec.error.message)}`)
        }
      }

      const localBranch = await runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
      let localAhead = false

      if (localBranch.error) {
        const createBranch = await runGit(['branch', '--track', branch, `origin/${branch}`])
        if (createBranch.error) {
          return e.reply(`创建本地跟踪分支失败：${this.maskSecret(createBranch.stderr || createBranch.error.message)}`)
        }
      }

      if (force) {
        const checkout = await runGit(['checkout', '-f', branch])
        if (checkout.error) {
          const currentBranch = await runGit(['branch', '--show-current'])
          const currentName = currentBranch.error ? '未知' : currentBranch.stdout.trim()
          return e.reply(`强制切换失败，当前仍在分支 [${currentName}]：\n${this.maskSecret(checkout.stderr || checkout.error.message)}`)
        }

        const setUpstream = await runGit(['branch', '--set-upstream-to', `origin/${branch}`, branch])
        if (setUpstream.error) {
          return e.reply(`分支已强制切换，但设置跟踪关系失败：${this.maskSecret(setUpstream.stderr || setUpstream.error.message)}`)
        }
      } else if (localBranch.error) {
        const checkout = await runGit(['checkout', branch])
        if (checkout.error) {
          const currentBranch = await runGit(['branch', '--show-current'])
          const currentName = currentBranch.error ? '未知' : currentBranch.stdout.trim()
          return e.reply(`本地分支 [${branch}] 已创建，但切换失败；当前仍在分支 [${currentName}]。请处理工作区后重试：\n${this.maskSecret(checkout.stderr || checkout.error.message)}`)
        }
      } else {
        let relation = await this.getBranchRelation(runGit, branch)

        // 浅历史可能无法判断原本可以快进的关系，仅在此时补全目标分支历史后重试。
        if (relation === 'diverged' && isShallow) {
          const unshallow = await runGit(['fetch', '--unshallow', '--no-tags', 'origin', refspec])
          if (!unshallow.error) relation = await this.getBranchRelation(runGit, branch)
        }

        if (relation === 'diverged') {
          return e.reply(`本地分支 [${branch}] 与远端已经分叉，请手动处理后再切换`)
        }

        const checkout = await runGit(['checkout', branch])
        if (checkout.error) {
          return e.reply(`切换分支失败：${this.maskSecret(checkout.stderr || checkout.error.message)}`)
        }

        const setUpstream = await runGit(['branch', '--set-upstream-to', `origin/${branch}`, branch])
        if (setUpstream.error) {
          return e.reply(`设置分支跟踪关系失败：${this.maskSecret(setUpstream.stderr || setUpstream.error.message)}`)
        }
        if (relation === 'behind') {
          const merge = await runGit(['merge', '--ff-only', `origin/${branch}`])
          if (merge.error) {
            return e.reply(`分支快进更新失败：${this.maskSecret(merge.stderr || merge.error.message)}`)
          }
        } else if (relation === 'ahead') {
          localAhead = true
        }
      }

      const currentBranch = await runGit(['branch', '--show-current'])
      const currentCommit = await runGit(['rev-parse', '--short', 'HEAD'])
      if (currentBranch.error || currentCommit.error) {
        return e.reply(`分支已切换，但读取当前版本失败，请重启后检查插件状态`)
      }

      const aheadTip = localAhead ? '\n本地分支领先远端，已保留本地提交。' : ''
      if (force) {
        return e.reply(`插件 [${name}] 已强制切换到分支 [${currentBranch.stdout.trim()}]，当前版本 ${currentCommit.stdout.trim()}。\n本命令未执行插件更新，请继续使用 Yunzai 自带的强制更新插件命令。`)
      }
      return e.reply(`插件 [${name}] 已切换到分支 [${currentBranch.stdout.trim()}]，当前版本 ${currentCommit.stdout.trim()}。${aheadTip}\n重启后生效。`)
    } catch (error) {
      logger.error(`[插件管理器] 切换插件分支失败: ${error.message}`)
      return e.reply(`切换插件分支失败：${this.maskSecret(error.message)}`)
    }
  }

  /** 显式强制切换入口；仅在命令包含“强制”时启用破坏性 checkout。 */
  async forceSwitchPluginBranch(e) {
    return this.switchPluginBranch(e, true)
  }

  /** 判断本地分支相对 origin 分支的关系。 */
  async getBranchRelation(runGit, branch) {
    const localRef = `refs/heads/${branch}`
    const remoteRef = `refs/remotes/origin/${branch}`
    const localIsAncestor = await runGit(['merge-base', '--is-ancestor', localRef, remoteRef])
    const remoteIsAncestor = await runGit(['merge-base', '--is-ancestor', remoteRef, localRef])

    if (!localIsAncestor.error && !remoteIsAncestor.error) return 'equal'
    if (!localIsAncestor.error) return 'behind'
    if (!remoteIsAncestor.error) return 'ahead'
    return 'diverged'
  }

  /** 将 Git fetch 失败原因转换为明确且脱敏的用户提示。 */
  formatRemoteFetchError(branch, result) {
    const detail = this.maskSecret(
      [result.stderr, result.error?.message].filter(Boolean).join('\n').trim()
    )

    if (/could(?:n't| not) find remote ref|remote ref .* not found|not our ref|找不到远程引用/i.test(detail)) {
      return `远端分支 [${branch}] 不存在`
    }
    if (/could not resolve hostname|connection (?:timed out|refused|reset|closed)|network is unreachable|no route to host|命令执行超时|operation timed out/i.test(detail)) {
      return `访问远端失败：无法连接 SSH/Git 远端，请检查网络、DNS 或 SSH 端口\n${detail}`
    }
    if (/permission denied \(publickey\)|authentication failed|could not read from remote repository|access rights|repository not found/i.test(detail)) {
      return `访问远端失败：SSH 密钥、仓库权限或认证配置异常\n${detail}`
    }

    return `获取远端分支 [${branch}] 失败：${detail || '未知 Git 错误'}`
  }

  async uninstallPlugin(e) {
    if (!this.checkPermission(e)) return false

    try {
      const match = e.msg.match(/^#(删除|卸载)插件(.*)$/)
      if (!match) return false

      const name = match[2].trim()
      if (!name) return e.reply('请提供要卸载的插件名称')

      if (CONFIG.protectedPlugins.includes(name)) {
        return e.reply('禁止卸载核心组件')
      }

      if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') return e.reply('插件名称格式不正确')
      const pluginPath = path.join(CONFIG.pluginsDir, name)
      if (fs.existsSync(pluginPath) && fs.lstatSync(pluginPath).isSymbolicLink()) return e.reply('不支持卸载符号链接目录')
      if (!fs.existsSync(pluginPath)) {
        return e.reply('插件不存在')
      }

      fs.rmSync(pluginPath, { recursive: true, force: true })
      await e.reply(`插件 [${name}] 卸载成功`)
    } catch (error) {
      logger.error(`[插件管理器] 卸载插件失败: ${error.message}`)
      e.reply(`卸载插件失败: ${error.message}`)
    }
  }

  /**
   * 重置配置文件
   */
  async resetConfig(e) {
    if (!this.checkPermission(e)) return false

    try {
      // 备份当前配置文件
      if (fs.existsSync(CONFIG_FILE)) {
        const backupFile = `${CONFIG_FILE}.backup.${Date.now()}`
        fs.copyFileSync(CONFIG_FILE, backupFile)
        await e.reply(`已备份当前配置文件: ${path.basename(backupFile)}`)
      }

      fs.writeFileSync(CONFIG_FILE, stringify(DEFAULT_CONFIG), 'utf8')
      CONFIG = initConfigFile()
      lastConfigModified = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : 0

      await e.reply('配置文件已重置，请编辑配置文件填入正确的OAuth2认证信息')
      await e.reply(`配置文件路径: ${CONFIG_FILE}`)

      return true
    } catch (error) {
      logger.error(`[插件管理器] 重置配置文件失败: ${error.message}`)
      e.reply(`重置配置文件失败: ${error.message}`)
      return false
    }
  }

  /**
   * 重载配置文件命令
   */
  async reloadConfigCommand(e) {
    if (!this.checkPermission(e)) return false

    try {
      const success = reloadConfig()
      if (success) {
        await e.reply('配置文件重载成功')
      } else {
        await e.reply('配置文件重载失败')
      }
      return success
    } catch (error) {
      logger.error(`[插件管理器] 重载配置文件失败: ${error.message}`)
      e.reply(`重载配置文件失败: ${error.message}`)
      return false
    }
  }

  /**
   * 搜索GitHub、Gitcode仓库（简短命令）
   * 指令：
   *   #github搜索 <关键词> (支持大小写)
   *   #gitcode搜索 <关键词> (支持大小写)
   */
  async searchRepositoryShort(e) {
    if (!this.checkPermission(e)) return false

    // 提取平台名（不区分大小写）
    const rawMsg = e.msg.toLowerCase()
    let platform = ''
    if (rawMsg.includes('github')) platform = 'github'
    else if (rawMsg.includes('gitcode')) platform = 'gitcode'

    if (!platform) return false

    const keyword = e.msg.replace(/^#[Gg][Ii][Tt](?:[Hh][Uu][Bb]|[Cc][Oo][Dd][Ee])搜索/, '').trim()
    if (!keyword) return e.reply('请提供要搜索的仓库名称')

    const platformName = {
      'github': 'GitHub',
      'gitcode': 'Gitcode'
    }[platform]

    await e.reply(`正在${platformName}搜索仓库: ${keyword}，请稍候...`)

    let results = []
    if (platform === 'github') {
      const repos = await this.searchGitHub(keyword).catch(error => { logger.error(error); return [] })
      results = repos.map(r => ({ ...r, platform: 'GitHub' }))
    } else if (platform === 'gitcode') {
      const repos = await this.searchGitcode(keyword).catch(error => { logger.error(error); return [] })
      results = repos.map(r => ({ ...r, platform: 'Gitcode' }))
    }

    if (results.length === 0) {
      return e.reply(`在${platformName}未找到与 "${keyword}" 相关的仓库`)
    }

    const msgList = results.slice(0, 15).map(repo => ({
      user_id: e.self_id,
      message: `平台: ${repo.platform}\n仓库名: ${repo.name}\n作者: ${repo.owner}\n描述: ${repo.description || '无'}\nURL: ${repo.url}\n安装指令: #安装插件 ${repo.url}`
    }))

    const msg = e.isGroup ? await e.group.makeForwardMsg(msgList) : await e.friend.makeForwardMsg(msgList)
    await e.reply(msg)
  }

  /**
   * 搜索GitHub、Gitcode仓库
   * 指令：
   *   #搜索仓库 <关键词> - 搜索所有平台
   *   #搜索github仓库 <关键词> - 只搜索GitHub
   *   #搜索gitcode仓库 <关键词> - 只搜索Gitcode
   */
  async searchRepository(e) {
    if (!this.checkPermission(e)) return false

    const match = e.msg.match(/^#搜索(github|gitcode)?仓库(.+)$/)
    if (!match) return false

    const platform = match[1] ? match[1].toLowerCase() : 'all'
    const keyword = match[2].trim()
    if (!keyword) return e.reply('请提供要搜索的仓库名称')

    const platformName = {
      'github': 'GitHub',
      'gitcode': 'Gitcode',
      'all': '所有平台'
    }[platform]

    await e.reply(`正在${platformName}搜索仓库: ${keyword}，请稍候...`)

    const results = []

    // 根据指定平台搜索
    if (platform === 'all') {
      const [githubRes, gitcodeRes] = await Promise.allSettled([
        this.searchGitHub(keyword),
        this.searchGitcode(keyword)
      ])
      if (githubRes.status === 'fulfilled') results.push(...githubRes.value.map(r => ({ ...r, platform: 'GitHub' })))
      if (gitcodeRes.status === 'fulfilled') results.push(...gitcodeRes.value.map(r => ({ ...r, platform: 'Gitcode' })))
    } else if (platform === 'github') {
      const repos = await this.searchGitHub(keyword).catch(error => { logger.error(error); return [] })
      results.push(...repos.map(r => ({ ...r, platform: 'GitHub' })))
    } else if (platform === 'gitcode') {
      const repos = await this.searchGitcode(keyword).catch(error => { logger.error(error); return [] })
      results.push(...repos.map(r => ({ ...r, platform: 'Gitcode' })))
    }

    if (results.length === 0) {
      return e.reply(`在${platformName}未找到与 "${keyword}" 相关的仓库`)
    }

    const msgList = results.slice(0, 15).map(repo => ({
      user_id: e.self_id,
      message: `平台: ${repo.platform}\n仓库名: ${repo.name}\n作者: ${repo.owner}\n描述: ${repo.description || '无'}\nURL: ${repo.url}\n安装指令: #安装插件 ${repo.url}`
    }))

    const msg = e.isGroup ? await e.group.makeForwardMsg(msgList) : await e.friend.makeForwardMsg(msgList)
    await e.reply(msg)
  }

  /** 平台搜索也只筛选 Markdown 索引中的仓库。 */
  async searchGitHub(query) {
    return this.searchIndexedRepositories(query, 'github.com')
  }

  async searchGitcode(query) {
    return this.searchIndexedRepositories(query, 'gitcode.com')
  }

  async searchIndexedRepositories(query, host) {
    const list = await this.fetchPluginList()
    const keyword = query.toLowerCase()
    return list.filter(item => new URL(item.url).hostname === host &&
      [item.pluginname, item.pathname, item.author, item.describe].some(value => value.toLowerCase().includes(keyword)))
      .slice(0, 15).map(item => ({ name: item.pluginname, owner: item.author, description: item.describe, url: item.url }))
  }

  async fetchPluginList() {
    return fetchPluginIndex()
  }

  /** 获取 pnpm 命令，兼容 macOS 的 Homebrew 默认安装位置。 */
  getPnpmCommand() {
    if (process.platform !== 'darwin') {
      return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    }

    const candidates = [
      process.env.PNPM_HOME && path.join(process.env.PNPM_HOME, 'pnpm'),
      '/opt/homebrew/bin/pnpm',
      '/usr/local/bin/pnpm'
    ].filter(Boolean)

    return candidates.find(candidate => fs.existsSync(candidate)) || 'pnpm'
  }

  /**
   * 以参数形式执行命令，避免 Windows、macOS 和 Linux 的 shell 转义差异。
   */
  async runCommand(command, args, options = {}) {
    return new Promise((resolve) => {
      const timeout = options.timeout || CONFIG.gitTimeout
      let timedOut = false

      const macPaths = process.platform === 'darwin'
        ? [process.env.PNPM_HOME, '/opt/homebrew/bin', '/usr/local/bin']
        : []
      const env = {
        ...process.env,
        ...options.env,
        PATH: [...macPaths, process.env.PATH].filter(Boolean).join(path.delimiter)
      }
      const { timeout: _timeout, env: _env, ...execOptions } = options

      const child = execFile(command, args, { windowsHide: true, ...execOptions, env }, (error, stdout, stderr) => {
        if (timedOut) return
        resolve({ error, stdout, stderr })
      })

      if (timeout) {
        const timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
          resolve({ error: new Error(`命令执行超时 (${timeout}ms)`), stdout: '', stderr: '' })
        }, timeout)

        child.on('exit', () => clearTimeout(timer))
      }
    })
  }
}
