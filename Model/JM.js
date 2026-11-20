import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse, stringify } from 'yaml'

const execFileAsync = promisify(execFile)
export const jmPluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(jmPluginRoot, 'config', 'JM.yaml')
export const jmLocalConfigPath = path.join(jmPluginRoot, 'config', 'JM.local.yaml')
export const jmDataDir = path.join(jmPluginRoot, 'data', 'JM')
export const jmComicConfigPath = path.join(jmPluginRoot, 'config', 'JMComic.yml')
const legacyJmComicConfigPath = path.join(jmPluginRoot, 'config', 'JMComic.yaml')

const defaults = {
  allowMaster: true,
  users: [],
  pythonCommand: '',
  jmcomicCommand: 'jmcomic',
  cacheLimit: 5,
  features: { download: true, search: true, rank: true },
}

function readYaml(file) {
  if (!fs.existsSync(file)) return {}
  const value = parse(fs.readFileSync(file, 'utf8'))
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function readJmConfig() {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, stringify(defaults), 'utf8')
  const config = { ...defaults, ...readYaml(configPath) }
  const local = readYaml(jmLocalConfigPath)
  config.allowMaster = local.allowMaster ?? config.allowMaster
  config.users = [...new Set((Array.isArray(local.users) ? local.users : Array.isArray(config.users) ? config.users : []).map(String))]
  config.features = { ...defaults.features, ...(config.features || {}), ...(local.features || {}) }
  config.cacheLimit = Math.max(1, Math.min(50, Number(config.cacheLimit) || defaults.cacheLimit))
  return config
}

export function isJmFeatureEnabled(feature) {
  const config = readJmConfig()
  return config.features?.[feature] !== false
}

export function canUseJm(e) {
  try {
    const config = readJmConfig()
    return (config.allowMaster === true && e?.isMaster === true) || config.users.includes(String(e?.user_id ?? ''))
  } catch (error) {
    logger.error('[JM] 读取权限配置失败：', error)
    return false
  }
}

export async function ensureJmComicConfig() {
  await fs.promises.mkdir(jmDataDir, { recursive: true })
  try {
    await fs.promises.access(jmComicConfigPath)
  } catch {
    try {
      await fs.promises.rename(legacyJmComicConfigPath, jmComicConfigPath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  let config
  try {
    config = readYaml(jmComicConfigPath)
  } catch {
    config = {}
  }
  if (!Object.keys(config).length) {
    config = {
      log: true,
      client: { retry_times: 5 },
      download: {
        cache: true,
        image: { decode: true, suffix: '.jpg' },
        threading: { image: 25 },
      },
      dir_rule: { base_dir: jmDataDir, rule: 'Bd_Ptitle' },
    }
    await fs.promises.writeFile(jmComicConfigPath, stringify(config), 'utf8')
  } else if (!config.dir_rule?.base_dir) {
    config.dir_rule ||= {}
    config.dir_rule.base_dir = jmDataDir
    config.dir_rule.rule ||= 'Bd_Ptitle'
    await fs.promises.writeFile(jmComicConfigPath, stringify(config), 'utf8')
  }
  return jmComicConfigPath
}

async function execute(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
    windowsHide: true,
  })
}

export async function runJmcomic(args, options = {}) {
  const config = readJmConfig()
  return execute(config.jmcomicCommand || 'jmcomic', args, options)
}

export async function runPython(scriptName, args = [], options = {}) {
  const config = readJmConfig()
  const scriptPath = path.join(jmPluginRoot, 'Python', scriptName)
  const configured = String(config.pythonCommand || '').trim()
  const candidates = configured
    ? [[configured, []]]
    : process.platform === 'win32'
      ? [['py', ['-3']], ['python3', []], ['python', []]]
      : [['python3', []], ['python', []]]

  let lastError
  for (const [command, prefix] of candidates) {
    try {
      return await execute(command, [...prefix, scriptPath, ...args], options)
    } catch (error) {
      lastError = error
      if (error.code !== 'ENOENT') throw error
    }
  }
  throw lastError || new Error('未找到 Python 3，请在 config/JM.yaml 配置 pythonCommand')
}

export async function runUtility(command, args, options = {}) {
  return execute(command, args, options)
}

export async function sendJmFile(e, filePath) {
  const target = e?.isGroup ? e.group : e.friend
  if (typeof target?.sendFile === 'function') return target.sendFile(filePath)
  if (e?.isGroup && typeof target?.fs?.upload === 'function') return target.fs.upload(filePath)
  throw new Error(e?.isGroup ? '当前群适配器不支持发送文件' : '当前私聊适配器不支持发送文件')
}

export async function sendJmForward(e, entries, fallbackText) {
  const target = e?.isGroup ? e.group : e.friend
  if (typeof target?.makeForwardMsg === 'function') {
    return e.reply(await target.makeForwardMsg(entries))
  }
  return e.reply(fallbackText, true)
}
