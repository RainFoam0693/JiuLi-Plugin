/** 反代为 HTTPS URL 前缀，如 https://proxy.example/ 。 */
export function normalizeCloneProxy(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  let url
  try { url = new URL(value.trim()) } catch { throw new Error('请输入有效的 HTTPS 反代地址') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('反代地址必须为 HTTPS，且不能包含账号、密码、查询参数或片段')
  return url.href.replace(/\/+$/, '') + '/'
}

export function publicCloneProxy(repository, config, access) {
  if (config.httpsProxyEnabled !== true || access !== 'public') return null
  const prefix = normalizeCloneProxy(config.httpsProxyUrl)
  if (!prefix) throw new Error('已开启 HTTPS 反代克隆，请先在锅巴填写反代地址')
  const url = new URL(repository)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('反代仅支持无凭据的 HTTPS 公开仓库地址')
  return prefix + url.href
}
