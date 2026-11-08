import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { normalizeCloneProxy } from './CloneProxy.js'
import { detectRepositoryAccess } from './RepositoryAccess.js'
const execute = promisify(execFile)
const hosts = new Set(['github.com', 'gitcode.com', 'gitcode.net', 'gitee.com'])

export function parseRemote(raw) {
  const ssh = /^git@([^:]+):(.+)$/.exec(raw)
  let url
  try { url = new URL(ssh ? `https://${ssh[1]}/${ssh[2]}` : raw) } catch { return null }
  if (!hosts.has(url.hostname) || (!ssh && !['https:', 'ssh:'].includes(url.protocol)) || url.port || url.search || url.hash) return null
  if (url.protocol === 'ssh:' && url.username !== 'git') return null
  const parts = url.pathname.replace(/\.git$/, '').split('/').filter(Boolean)
  if (parts.length !== 2 || parts.some(x => !/^[\w.-]+$/.test(x) || x === '.' || x === '..')) return null
  return { host: url.hostname, repository: parts.join('/'), protocol: ssh || url.protocol === 'ssh:' ? 'ssh' : 'https' }
}
export function protocolUrl(raw, protocol) {
  const repo = parseRemote(raw)
  if (!repo || !['https', 'ssh'].includes(protocol)) throw new Error('仅支持 GitHub、GitCode、Gitee 标准仓库地址')
  return protocol === 'ssh' ? `git@${repo.host}:${repo.repository}.git` : `https://${repo.host}/${repo.repository}.git`
}
/** 识别“反代前缀/https://平台/仓库”，即使配置前缀改变也能关闭旧反代。 */
export function remoteDetails(raw) {
  const direct = parseRemote(raw)
  if (direct) return { ...direct, source: raw, proxyEnabled: false }
  if (typeof raw !== 'string') return null
  const marker = raw.indexOf('/https://')
  if (marker < 0) return null
  try {
    const prefix = normalizeCloneProxy(raw.slice(0, marker + 1))
    const source = raw.slice(marker + 1)
    const remote = parseRemote(source)
    const url = new URL(source)
    if (!remote || remote.protocol !== 'https' || url.username || url.password) return null
    return { ...remote, source, proxyEnabled: true, prefix }
  } catch { return null }
}
const digest = values => createHash('sha256').update(JSON.stringify(values)).digest('hex')

export class PluginRepositories {
  constructor(root, hostRoot = null, options = {}) { this.configFile = options.configFile || fileURLToPath(new URL('../config/PluginManager.yaml', import.meta.url)); this.detectAccess = options.detectAccess || detectRepositoryAccess; this.root = path.resolve(root); this.hostRoot = hostRoot ? path.resolve(hostRoot) : null; this.locks = new Set(); this.watchers = new Map(); this.revision = 0 }
  async git(dir, args) {
    const result = await execute('git', ['-C', dir, ...args], { timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    return result.stdout.trim()
  }
  async directory(name, kind = 'plugin') {
    if (!['plugin', 'core'].includes(kind)) throw new Error('仓库类型无效')
    if (kind === 'core' && !this.hostRoot) throw new Error('机器人本体目录未配置')
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\x00]/.test(name)) throw new Error('插件名称无效')
    // 本体目录只能由服务端指定，客户端不能传入任意路径。
    const dir = kind === 'core' ? this.hostRoot : path.join(this.root, name)
    const stat = await fsp.lstat(dir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('不支持链接目录')
    const dotgit = await fsp.lstat(path.join(dir, '.git'))
    if (dotgit.isSymbolicLink()) throw new Error('不支持链接 Git 目录')
    if (await fsp.realpath(dir) !== await this.git(dir, ['rev-parse', '--show-toplevel'])) throw new Error('不是独立插件仓库')
    return dir
  }
  async origins(dir) {
    const get = async key => {
      try { return (await this.git(dir, ['config', '--local', '--get-all', key])).split('\n').filter(Boolean) }
      catch (e) { if (e.code === 1) return []; throw new Error('无法读取 Git 远端配置') }
    }
    const urls = await get('remote.origin.url'), pushes = await get('remote.origin.pushurl')
    const authOrigin = (await get('jiuli.authOrigin'))[0] || ''
    const authHeaders = authOrigin ? await get(`http.${authOrigin}.extraHeader`) : []
    return { urls, pushes, authOrigin, authHeaders }
  }
  async list() {
    const entries = await fsp.readdir(this.root, { withFileTypes: true })
    const records = []
    const paths = new Set([this.root, this.configFile])
    const candidates = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')).sort((a,b) => a.name.localeCompare(b.name)).map(entry => ({ name: entry.name, kind: 'plugin' }))
    if (this.hostRoot) {
      const manifest = path.join(this.hostRoot, 'package.json')
      paths.add(manifest)
      let displayName = path.basename(this.hostRoot)
      try {
        const metadata = JSON.parse(await fsp.readFile(manifest, 'utf8'))
        if (typeof metadata.name === 'string' && metadata.name.trim()) displayName = metadata.name.trim()
      } catch { /* 清单缺失或正在写入时使用目录名称。 */ }
      candidates.unshift({ name: '__core__', displayName, kind: 'core' })
    }
    for (const entry of candidates) {
      try {
        const dir = await this.directory(entry.name, entry.kind)
        const state = await this.origins(dir)
        const remote = state.urls.length === 1 ? remoteDetails(state.urls[0]) : null
        const push = state.pushes.length === 1 ? remoteDetails(state.pushes[0]) : null
        const supported = Boolean(remote && state.pushes.length <= 1 && (!state.pushes.length || push))
        records.push({ name: entry.name, displayName: entry.displayName || entry.name, kind: entry.kind, repository: remote ? `${remote.host}/${remote.repository}` : '无 origin 或不支持的远端', protocol: remote?.protocol || '', proxyEnabled: remote?.proxyEnabled === true, authEnabled: Boolean(remote?.protocol === 'https' && !remote.proxyEnabled && state.authOrigin === protocolUrl(remote.source, 'https') && state.authHeaders.some(value => /^Authorization:/i.test(value))), pushProtocol: push?.protocol || remote?.protocol || '', supported, version: digest(state) })
        const config = await this.git(dir, ['rev-parse', '--git-path', 'config'])
        paths.add(path.resolve(dir, config)); paths.add(path.join(dir, '.git'))
      } catch { /* 不是 Git 插件的目录不列入仓库列表。 */ }
    }
    for (const file of paths) if (!this.watchers.has(file)) {
      const listener = () => { this.revision++ }
      fs.watchFile(file, { persistent: false, interval: 2000 }, listener)
      this.watchers.set(file, listener)
    }
    for (const [file, listener] of this.watchers) if (!paths.has(file)) { fs.unwatchFile(file, listener); this.watchers.delete(file) }
    return { revision: this.revision, plugins: records }
  }
  async switch(name, protocol, version, kind = 'plugin') {
    if (!['https','ssh'].includes(protocol)) throw new Error('请选择 HTTPS 或 SSH')
    const lockKey = `${kind}:${name}`
    if (this.locks.has(lockKey)) throw new Error('该插件正在切换，请稍后刷新')
    this.locks.add(lockKey)
    try {
      const dir = await this.directory(name, kind)
      const state = await this.origins(dir)
      if (version !== digest(state)) throw new Error('仓库配置已变化，请刷新后重试')
      if (state.urls.length !== 1 || state.pushes.length > 1) throw new Error('不支持无 origin 或多地址配置')
      const url = protocolUrl(remoteDetails(state.urls[0])?.source || state.urls[0], protocol)
      const push = state.pushes.length ? protocolUrl(remoteDetails(state.pushes[0])?.source || state.pushes[0], protocol) : null
      try {
        await this.git(dir, ['config','--local','--replace-all','remote.origin.url',url])
        if (push) await this.git(dir, ['config','--local','--replace-all','remote.origin.pushurl',push])
      } catch {
        await this.git(dir, ['config','--local','--replace-all','remote.origin.url',state.urls[0]])
        if (state.pushes.length) await this.git(dir, ['config','--local','--replace-all','remote.origin.pushurl',state.pushes[0]])
        throw new Error('切换失败，已尝试恢复原远端配置')
      }
      this.revision++
      return { name, kind, protocol }
    } finally { this.locks.delete(lockKey) }
  }
  async setProxy(name, enabled, version, kind = 'plugin') {
    if (typeof enabled !== 'boolean') throw new Error('反代开关值无效')
    const lockKey = `${kind}:${name}`
    if (this.locks.has(lockKey)) throw new Error('该仓库正在操作，请稍后刷新')
    this.locks.add(lockKey)
    try {
      const dir = await this.directory(name, kind)
      const state = await this.origins(dir)
      if (version !== digest(state)) throw new Error('仓库配置已变化，请刷新后重试')
      if (state.urls.length !== 1 || state.pushes.length > 1) throw new Error('不支持无 origin 或多地址配置')
      const remote = remoteDetails(state.urls[0])
      if (!remote || remote.protocol !== 'https') throw new Error('仅 HTTPS 仓库可注入反代，请先切换为 HTTPS')
      const original = protocolUrl(remote.source, 'https')
      let url = original
      if (enabled) {
        if (state.authOrigin === original && state.authHeaders.some(value => /^Authorization:/i.test(value))) throw new Error('请先关闭用户名与密钥注入，再开启反代')
        const source = new URL(remote.source)
        if (source.username || source.password) throw new Error('带有凭据的远端不能注入反代')
        let config
        try { config = parse(await fsp.readFile(this.configFile, 'utf8')) } catch { throw new Error('请先在锅巴配置 HTTPS 反代地址') }
        const prefix = normalizeCloneProxy(config?.httpsProxyUrl)
        if (!prefix) throw new Error('请先在锅巴配置 HTTPS 反代地址')
        if (await this.detectAccess(original) !== 'public') throw new Error('无法确认仓库可公开读取，未注入反代；私库请保持直连')
        url = prefix + original
        if (digest(await this.origins(dir)) !== version) throw new Error('仓库配置已变化，请刷新后重试')
      }
      const addPush = enabled && state.pushes.length === 0
      try {
        // 拉取走反代；推送保持平台直连，避免默认随 origin 转到第三方。
        if (addPush) await this.git(dir, ['config','--local','--replace-all','remote.origin.pushurl',original])
        await this.git(dir, ['config','--local','--replace-all','remote.origin.url',url])
      } catch {
        await this.git(dir, ['config','--local','--replace-all','remote.origin.url',state.urls[0]])
        if (addPush) await this.git(dir, ['config','--local','--unset-all','remote.origin.pushurl']).catch(() => {})
        throw new Error('反代切换失败，已尝试恢复原配置')
      }
      this.revision++
      return { name, kind, proxyEnabled: enabled }
    } finally { this.locks.delete(lockKey) }
  }
  async replaceValues(dir, key, values) {
    try { await this.git(dir, ['config', '--local', '--unset-all', key]) }
    catch (e) { if (e.code !== 5 && e.code !== 1) throw e }
    for (const value of values) await this.git(dir, ['config', '--local', '--add', key, value])
  }
  async setAuth(name, enabled, version, kind = 'plugin') {
    if (typeof enabled !== 'boolean') throw new Error('认证开关值无效')
    const lockKey = `${kind}:${name}`
    if (this.locks.has(lockKey)) throw new Error('该仓库正在操作，请稍后刷新')
    this.locks.add(lockKey)
    try {
      const dir = await this.directory(name, kind)
      const state = await this.origins(dir)
      if (version !== digest(state)) throw new Error('仓库配置已变化，请刷新后重试')
      if (state.urls.length !== 1 || state.pushes.length > 1) throw new Error('不支持无 origin 或多地址配置')
      const remote = remoteDetails(state.urls[0])
      if (!remote || remote.protocol !== 'https') throw new Error('仅 HTTPS 仓库可注入用户名与密钥')
      if (remote.proxyEnabled) throw new Error('请先关闭反代，再注入用户名与密钥')
      const origin = protocolUrl(remote.source, 'https')
      if (state.authOrigin && state.authOrigin !== origin) throw new Error('该仓库存在其他地址的认证设置，请先检查 Git 配置')
      let headers = []
      try { headers = (await this.git(dir, ['config','--local','--get-all',`http.${origin}.extraHeader`])).split('\n').filter(Boolean) }
      catch (e) { if (e.code !== 1) throw new Error('无法读取仓库认证配置') }
      if (!state.authOrigin && headers.some(value => /^Authorization:/i.test(value))) throw new Error('该仓库已有独立认证配置，未覆盖原设置')
      let values = headers.filter(value => !/^Authorization:/i.test(value))
      if (enabled) {
        let config
        try { config = parse(await fsp.readFile(this.configFile, 'utf8')) } catch { throw new Error('请先在锅巴配置平台用户名和访问令牌') }
        const host = remote.host === 'gitcode.net' ? 'gitcode.com' : remote.host
        const auth = config?.auth?.[host]
        if (typeof auth?.username !== 'string' || !auth.username.trim() || typeof auth.token !== 'string' || !auth.token.trim() || auth.token === '秘钥') throw new Error('请先在锅巴配置对应平台的用户名和访问令牌')
        if (/[\x00-\x1f\x7f:]/.test(auth.username) || /[\r\n\x00]/.test(auth.token)) throw new Error('用户名或令牌格式无效')
        values.push(`Authorization: Basic ${Buffer.from(`${auth.username.trim()}:${auth.token.trim()}`).toString('base64')}`)
      }
      try {
        await this.replaceValues(dir, `http.${origin}.extraHeader`, values)
        await this.replaceValues(dir, 'jiuli.authOrigin', enabled ? [origin] : [])
      } catch {
        await this.replaceValues(dir, `http.${origin}.extraHeader`, headers)
        await this.replaceValues(dir, 'jiuli.authOrigin', state.authOrigin ? [state.authOrigin] : [])
        throw new Error('认证切换失败，已尝试恢复原配置')
      }
      this.revision++
      return { name, kind, authEnabled: enabled }
    } finally { this.locks.delete(lockKey) }
  }
  close() { for (const [file, listener] of this.watchers) fs.unwatchFile(file, listener); this.watchers.clear() }
}
