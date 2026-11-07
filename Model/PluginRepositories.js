import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
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
const digest = values => createHash('sha256').update(JSON.stringify(values)).digest('hex')

export class PluginRepositories {
  constructor(root, hostRoot = null) { this.root = path.resolve(root); this.hostRoot = hostRoot ? path.resolve(hostRoot) : null; this.locks = new Set(); this.watchers = new Map(); this.revision = 0 }
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
    return { urls: await get('remote.origin.url'), pushes: await get('remote.origin.pushurl') }
  }
  async list() {
    const entries = await fsp.readdir(this.root, { withFileTypes: true })
    const records = []
    const paths = new Set([this.root])
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
        const remote = state.urls.length === 1 ? parseRemote(state.urls[0]) : null
        const push = state.pushes.length === 1 ? parseRemote(state.pushes[0]) : null
        const supported = Boolean(remote && state.pushes.length <= 1 && (!state.pushes.length || push))
        records.push({ name: entry.name, displayName: entry.displayName || entry.name, kind: entry.kind, repository: remote ? `${remote.host}/${remote.repository}` : '无 origin 或不支持的远端', protocol: remote?.protocol || '', pushProtocol: push?.protocol || remote?.protocol || '', supported, version: digest(state) })
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
      const url = protocolUrl(state.urls[0], protocol)
      const push = state.pushes.length ? protocolUrl(state.pushes[0], protocol) : null
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
  close() { for (const [file, listener] of this.watchers) fs.unwatchFile(file, listener); this.watchers.clear() }
}
