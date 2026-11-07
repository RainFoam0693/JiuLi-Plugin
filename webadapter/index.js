import path from 'node:path'
import { PluginRepositories } from '../Model/PluginRepositories.js'
const key = Symbol.for('JiuLi-Plugin.repositories-panel')
export function init(ctx) {
  globalThis[key]?.close()
  const repositories = new PluginRepositories(path.join(process.cwd(), 'plugins'))
  globalThis[key] = repositories
  ctx.registerPage({ id: 'repositories', title: '插件仓库', icon: '🗂️', src: 'repositories.html', script: 'repositories.js', style: 'repositories.css', priority: 20 })
  ctx.registerApi('get', '/repositories', async (_req,res) => {
    try { res.json({ok:true,result:await repositories.list()}) }
    catch { res.status(500).json({ok:false,message:'无法读取插件仓库列表'}) }
  })
  ctx.registerApi('post', '/repositories/switch', async (req,res) => {
    // 扩展接口由锅巴统一鉴权；额外拒绝跨站写请求。
    if (req.headers?.['sec-fetch-site'] === 'cross-site') return res.status(403).json({ok:false,message:'不允许跨站操作'})
    try { res.json({ok:true,result:await repositories.switch(req.body?.name,req.body?.protocol,req.body?.version)}) }
    catch (e) { res.status(400).json({ok:false,message:e.message.includes('Command failed') ? 'Git 配置操作失败，请检查目录权限' : e.message}) }
  })
}
