const params = new URLSearchParams(location.search)
const base = `${params.get('__webBase') || ''}/web-page/api/${encodeURIComponent(params.get('__plugin') || 'JiuLi-Plugin')}`
const coreList = document.getElementById('core-list'), list = document.getElementById('list'), status = document.getElementById('status')
let busy = false, loading = false, snapshot = ''
async function request(route, init = {}) {
  const headers = {Accept:'application/json',...init.headers}
  const token = localStorage.getItem('guoba-access-token')
  if (token) headers['guoba-access-token'] = token
  const response = await fetch(base+route,{...init,headers,credentials:'same-origin'})
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error(data.message || '请求失败')
  return data.result
}
function text(tag, value, cls) { const element=document.createElement(tag);element.textContent=value;if(cls)element.className=cls;return element }
async function refresh() {
  if (loading || busy || document.hidden) return
  loading=true
  try {
    const data=await request('/repositories'), next=JSON.stringify(data.plugins)
    if(next!==snapshot){
      coreList.replaceChildren()
      list.replaceChildren()
      for(const plugin of data.plugins){
        const row=text('article','','card'), info=text('div',''), name=text('div',plugin.displayName || plugin.name,'name')
        if(plugin.kind==='core') name.append(text('span','本体','badge'))
        name.append(text('span',plugin.protocol.toUpperCase() || '未知','badge'))
        info.append(name,text('div',plugin.repository,'repo'))
        if(plugin.pushProtocol!==plugin.protocol)info.append(text('div',`推送：${plugin.pushProtocol.toUpperCase()}`,'repo'))
        const target=plugin.protocol==='ssh'?'https':'ssh', button=text('button',plugin.supported?`切换为 ${target.toUpperCase()}`:'暂不支持')
        button.disabled=!plugin.supported;button.onclick=()=>switchRepo(plugin,target,button)
        const actions=text('div','','actions'), label=text('label','','proxy-switch')
        const toggle=document.createElement('input');toggle.type='checkbox';toggle.setAttribute('role','switch')
        toggle.setAttribute('aria-label',`${plugin.displayName || plugin.name} 注入反代`)
        toggle.checked=plugin.proxyEnabled===true;toggle.disabled=!plugin.supported || plugin.protocol!=='https' || plugin.authEnabled===true
        label.title=toggle.disabled?'SSH 或已注入密钥的仓库不支持反代':'使用锅巴中配置的反代地址，仅对公开仓库启用'
        label.append(toggle,text('span','','switch-track'),text('span','注入反代'))
        toggle.onchange=()=>toggleProxy(plugin,toggle)
        const authLabel=text('label','','proxy-switch'), authToggle=document.createElement('input')
        authToggle.type='checkbox';authToggle.setAttribute('role','switch')
        authToggle.setAttribute('aria-label',`${plugin.displayName || plugin.name} 注入密钥与用户名`)
        authToggle.checked=plugin.authEnabled===true
        authToggle.disabled=!plugin.supported || plugin.protocol!=='https' || plugin.proxyEnabled===true
        authLabel.title=authToggle.disabled?'请使用 HTTPS 直连并关闭反代':'使用锅巴保存的访问令牌（不是SSH私钥），保存在本地Git配置，仅对该仓库地址生效'
        authLabel.append(authToggle,text('span','','switch-track'),text('span','注入密钥与用户名'))
        authToggle.onchange=()=>toggleAuth(plugin,authToggle)
        actions.append(label,authLabel,button)
        row.append(info,actions);(plugin.kind==='core'?coreList:list).append(row)
      }
      if(!coreList.children.length) coreList.append(text('p','未检测到机器人 Git 仓库','empty'))
      if(!list.children.length) list.append(text('p','暂无 Git 插件','empty'))
      snapshot=next
    }
    status.className='';status.textContent=data.plugins.length?`${data.plugins.filter(p=>p.kind==='core').length} 个本体仓库 · ${data.plugins.filter(p=>p.kind!=='core').length} 个 Git 插件 · 已同步`:'暂无 Git 插件'
  } catch(error){status.className='error';status.textContent=error.message}
  finally{loading=false}
}
async function switchRepo(plugin,protocol,button){
  if(busy)return
  busy=true;button.disabled=true;button.textContent='正在切换…'
  try{
    await request('/repositories/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:plugin.name,protocol,version:plugin.version,kind:plugin.kind})})
    snapshot='';status.className='';status.textContent=`${plugin.displayName || plugin.name} 已切换为 ${protocol.toUpperCase()}`
  }catch(error){status.className='error';status.textContent=error.message}
  finally{busy=false;button.disabled=false;button.textContent=`切换为 ${protocol.toUpperCase()}`;await refresh()}
}
async function toggleProxy(plugin,toggle){
  if(busy){toggle.checked=plugin.proxyEnabled===true;return}
  busy=true;toggle.disabled=true
  let errorMessage=''
  try{
    await request('/repositories/proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:plugin.name,kind:plugin.kind,version:plugin.version,enabled:toggle.checked})})
    snapshot=''
  }catch(error){errorMessage=error.message;toggle.checked=plugin.proxyEnabled===true}
  finally{
    busy=false;toggle.disabled=plugin.protocol!=='https' || !plugin.supported
    await refresh()
    if(errorMessage){status.className='error';status.textContent=errorMessage}
  }
}
async function toggleAuth(plugin,toggle){
  if(busy){toggle.checked=plugin.authEnabled===true;return}
  busy=true;toggle.disabled=true
  let errorMessage=''
  try{
    await request('/repositories/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:plugin.name,kind:plugin.kind,version:plugin.version,enabled:toggle.checked})})
    snapshot=''
  }catch(error){errorMessage=error.message;toggle.checked=plugin.authEnabled===true}
  finally{
    busy=false;toggle.disabled=plugin.protocol!=='https' || !plugin.supported || plugin.proxyEnabled===true
    await refresh()
    if(errorMessage){status.className='error';status.textContent=errorMessage}
  }
}
document.getElementById('refresh').onclick=()=>{snapshot='';refresh()}
refresh();setInterval(refresh,3000)
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()})
