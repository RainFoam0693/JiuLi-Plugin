const hosts = new Set(['github.com', 'gitee.com', 'gitcode.com', 'gitcode.net'])

/** 用 Git 自己的 HTTPS 读取入口探测权限；404、限流、网络错误不直接认定私库。 */
export async function detectRepositoryAccess(repository, auth = {}, fetcher = globalThis.fetch) {
  const base = new URL(repository)
  if (base.protocol !== 'https:' || !hosts.has(base.hostname) || base.username || base.password || base.port || base.search || base.hash) throw new Error('仓库检测地址无效')
  const endpoint = new URL(`${base.href.replace(/\/?$/, '').replace(/\.git$/, '')}.git/info/refs?service=git-upload-pack`)
  const probe = async authorization => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 7000)
    try {
      let current = endpoint
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetcher(current.href, {
          method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: { Accept: 'application/x-git-upload-pack-advertisement', ...(authorization ? { Authorization: authorization } : {}) }
        })
        const status = response.status
        const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
        const location = response.headers.get('location')
        await response.body?.cancel()
        if ([301,302,307,308].includes(status) && location) {
          const next = new URL(location, current)
          // 绝不将认证头发送至重定向指向的其他站点。
          if (next.origin !== endpoint.origin || next.username || next.password) return { readable: false, status }
          current = next
          continue
        }
        return { readable: status === 200 && type === 'application/x-git-upload-pack-advertisement', status }
      }
    } catch { /* 连接和超时错误不能作为仓库私有性的证据。 */ }
    finally { clearTimeout(timer) }
    return { readable: false, status: 0 }
  }
  const anonymous = await probe()
  if (anonymous.readable) return 'public'
  if (!auth.token || auth.token === '秘钥' || ![200,401,403,404].includes(anonymous.status)) return 'unknown'
  const username = typeof auth.username === 'string' && auth.username.trim() ? auth.username.trim() : 'oauth2'
  const authorization = `Basic ${Buffer.from(`${username}:${auth.token}`).toString('base64')}`
  const authenticated = await probe(authorization)
  return authenticated.readable ? 'authenticated' : 'unknown'
}
