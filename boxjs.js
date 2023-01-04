const $ = new Env('BoxJs')

// 为 eval 准备的上下文环境
const $eval_env = {}

$.version = '0.12.2'
$.versionType = 'beta'

// 发出的请求需要需要 Surge、QuanX 的 rewrite
$.isNeedRewrite = true

/**
 * ===================================
 * 持久化属性: BoxJs 自有的数据结构
 * ===================================
 */

// 存储`用户偏好`
$.KEY_usercfgs = 'chavy_boxjs_userCfgs'
// 存储`应用会话`
$.KEY_sessions = 'chavy_boxjs_sessions'
// 存储`页面缓存`
$.KEY_web_cache = 'chavy_boxjs_web_cache'
// 存储`应用订阅缓存`
$.KEY_app_subCaches = 'chavy_boxjs_app_subCaches'
// 存储`全局备份` (弃用, 改用 `chavy_boxjs_backups`)
$.KEY_globalBaks = 'chavy_boxjs_globalBaks'
// 存储`备份索引`
$.KEY_backups = 'chavy_boxjs_backups'
// 存储`当前会话` (配合切换会话, 记录当前切换到哪个会话)
$.KEY_cursessions = 'chavy_boxjs_cur_sessions'

/**
 * ===================================
 * 持久化属性: BoxJs 公开的数据结构
 * ===================================
 */

// 存储用户访问`BoxJs`时使用的域名
$.KEY_boxjs_host = 'boxjs_host'

// 请求响应体 (返回至页面的结果)
$.json = $.name // `接口`类请求的响应体
$.html = $.name // `页面`类请求的响应体

// 页面源码地址
$.web = `https://cdn.jsdelivr.net/gh/chavyleung/scripts@${
  $.version
}/box/chavy.boxjs.html?_=${new Date().getTime()}`
// 版本说明地址 (Release Note)
$.ver = `https://raw.githubusercontent.com/chavyleung/scripts/master/box/release/box.release.json`

!(async () => {
  // 勿扰模式
  $.isMute = [true, 'true'].includes($.getdata('@chavy_boxjs_userCfgs.isMute'))

  // 请求路径
  $.path = getPath($request.url)

  // 请求类型: GET
  $.isGet = $request.method === 'GET'
  // 请求类型: POST
  $.isPost = $request.method === 'POST'
  // 请求类型: OPTIONS
  $.isOptions = $request.method === 'OPTIONS'

  // 请求类型: page、api、query
  $.type = 'page'
  // 查询请求: /query/xxx
  $.isQuery = $.isGet && /^\/query\/.*?/.test($.path)
  // 接口请求: /api/xxx
  $.isApi = $.isPost && /^\/api\/.*?/.test($.path)
  // 页面请求: /xxx
  $.isPage = $.isGet && !$.isQuery && !$.isApi

  // 升级用户数据
  upgradeUserData()
  // 升级备份数据
  upgradeGlobalBaks()

  // 处理预检请求
  if ($.isOptions) {
    $.type = 'options'
    await handleOptions()
  }
  // 处理`页面`请求
  else if ($.isPage) {
    $.type = 'page'
    await handlePage()
  }
  // 处理`查询`请求
  else if ($.isQuery) {
    $.type = 'query'
    await handleQuery()
  }
  // 处理`接口`请求
  else if ($.isApi) {
    $.type = 'api'
    await handleApi()
  }
})()
  .catch((e) => $.logErr(e))
  .finally(() => doneBox())

/**
 * http://boxjs.com/ => `http://boxjs.com`
 * http://boxjs.com/app/jd => `http://boxjs.com`
 */
function getHost(url) {
  return url.slice(0, url.indexOf('/', 8))
}

/**
 * http://boxjs.com/ => ``
 * http://boxjs.com/api/getdata => `/api/getdata`
 */
function getPath(url) {
  // 如果以`/`结尾, 去掉最后一个`/`
  const end = url.lastIndexOf('/') === url.length - 1 ? -1 : undefined
  // slice第二个参数传 undefined 会直接截到最后
  // indexOf第二个参数用来跳过前面的 "https://"
  return url.slice(url.indexOf('/', 8), end)
}

/**
 * ===================================
 * 处理前端请求
 * ===================================
 */

/**
 * 处理`页面`请求
 */
async function handlePage() {
  // 获取 BoxJs 数据
  const boxdata = getBoxData()
  boxdata.syscfgs.isDebugMode = false

  // 调试模式: 是否每次都获取新的页面
  const isDebugWeb = [true, 'true'].includes(
    $.getdata('@chavy_boxjs_userCfgs.isDebugWeb')
  )
  const debugger_web = $.getdata('@chavy_boxjs_userCfgs.debugger_web')
  const cache = $.getjson($.KEY_web_cache, null)

  // 如果没有开启调试模式，且当前版本与缓存版本一致，且直接取缓存
  if (!isDebugWeb && cache && cache.version === $.version) {
    $.html = cache.cache
  }
  // 如果开启了调试模式，并指定了 `debugger_web` 则从指定的地址获取页面
  else {
    if (isDebugWeb && debugger_web) {
      // 调试地址后面拼时间缀, 避免 GET 缓存
      const isQueryUrl = debugger_web.includes('?')
      $.web = `${debugger_web}${
        isQueryUrl ? '&' : '?'
      }_=${new Date().getTime()}`
      boxdata.syscfgs.isDebugMode = true
      console.log(`[WARN] Debug mode: $.web = : ${$.web}`)
    }
    // 如果调用这个方法来获取缓存, 且标记为`非调试模式`
    const getcache = () => {
      console.log(`[ERROR] Debug mode: Pages that are using cache!`)
      boxdata.syscfgs.isDebugMode = false
      return $.getjson($.KEY_web_cache).cache
    }
    await $.http.get($.web).then(
      (resp) => {
        if (/<title>BoxJs<\/title>/.test(resp.body)) {
          // 返回页面源码, 并马上存储到持久化仓库
          $.html = resp.body
          const cache = { version: $.version, cache: $.html }
          $.setjson(cache, $.KEY_web_cache)
        } else {
          // 如果返回的页面源码不是预期的, 则从持久化仓库中获取
          $.html = getcache()
        }
      },
      // 如果获取页面源码失败, 则从持久化仓库中获取
      () => ($.html = getcache())
    )
  }
  // 根据偏好设置, 替换首屏颜色 (如果是`auto`则交由页面自适应)
  const theme = $.getdata('@chavy_boxjs_userCfgs.theme')
  if (theme === 'light') {
    $.html = $.html.replace('#121212', '#fff')
  } else if (theme === 'dark') {
    $.html = $.html.replace('#fff', '#121212')
  }
  /**
   * 后端渲染数据, 感谢 https://t.me/eslint 提供帮助
   *
   * 如果直接渲染到 box: null 会出现双向绑定问题
   * 所以先渲染到 `boxServerData: null` 再由前端 `this.box = this.boxServerData` 实现双向绑定
   */
  $.html = $.html.replace(
    'boxServerData: null',
    'boxServerData:' + JSON.stringify(boxdata)
  )

  // 调试模式支持 vue Devtools (只有在同时开启调试模式和指定了调试地址才生效)
  // vue.min.js 生效时, 会导致 @click="window.open()" 报 "window" is not defined 错误
  if (isDebugWeb && debugger_web) {
    $.html = $.html.replace('vue.min.js', 'vue.js')
  }
}

/**
 * 处理`查询`请求
 */
async function handleQuery() {
  const [, query] = $.path.split('/query')
  if (/^\/boxdata/.test(query)) {
    $.json = getBoxData()
  } else if (/^\/baks/.test(query)) {
    const [, backupId] = query.split('/baks/')
    $.json = $.getjson(backupId)
  } else if (/^\/versions$/.test(query)) {
    await getVersions(true)
  } else if (/^\/data/.test(query)) {
    // TODO 记录每次查询的 key 至 usercfgs.viewkeys
    const [, dataKey] = query.split('/data/')
    $.json = {
      key: dataKey,
      val: $.getdata(dataKey)
    }
  }
}

/**
 * 处理 API 请求
 */
async function handleApi() {
  const [, api] = $.path.split('/api')

  if (api === '/save') {
    await apiSave()
  } else if (api === '/addAppSub') {
    await apiAddAppSub()
  } else if (api === '/reloadAppSub') {
    await apiReloadAppSub()
  } else if (api === '/delGlobalBak') {
    await apiDelGlobalBak()
  } else if (api === '/updateGlobalBak') {
    await apiUpdateGlobalBak()
  } else if (api === '/saveGlobalBak') {
    await apiSaveGlobalBak()
  } else if (api === '/impGlobalBak') {
    await apiImpGlobalBak()
  } else if (api === '/revertGlobalBak') {
    await apiRevertGlobalBak()
  } else if (api === '/runScript') {
    await apiRunScript()
  } else if (api === '/saveData') {
    await apiSaveData()
  }
}

async function handleOptions() {}

/**
 * ===================================
 * 获取基础数据
 * ===================================
 */

function getBoxData() {
  const datas = {}
  const usercfgs = getUserCfgs()
  const sessions = getAppSessions()
  const curSessions = getCurSessions()
  const sysapps = getSystemApps()
  const syscfgs = getSystemCfgs()
  const appSubCaches = getAppSubCaches()
  const globalbaks = getGlobalBaks()

  // 把 `内置应用`和`订阅应用` 里需要持久化属性放到`datas`
  sysapps.forEach((app) => Object.assign(datas, getAppDatas(app)))
  usercfgs.appsubs.forEach((sub) => {
    const subcache = appSubCaches[sub.url]
    if (subcache && subcache.apps && Array.isArray(subcache.apps)) {
      subcache.apps.forEach((app) => Object.assign(datas, getAppDatas(app)))
    }
  })

  const box = {
    datas,
    usercfgs,
    sessions,
    curSessions,
    sysapps,
    syscfgs,
    appSubCaches,
    globalbaks
  }
  return box
}

/**
 * 获取系统配置
 */
function getSystemCfgs() {
  // prettier-ignore
  return {
    env: $.isStash() ? 'Stash' : $.isShadowrocket() ? 'Shadowrocket' : $.isLoon() ? 'Loon' : $.isQuanX() ? 'QuanX' : $.isSurge() ? 'Surge' : 'Node',
    version: $.version,
    versionType: $.versionType,
    envs: [
      { id: 'Surge', icons: ['https://raw.githubusercontent.com/Orz-3/mini/none/surge.png', 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/surge.png'] },
      { id: 'QuanX', icons: ['https://raw.githubusercontent.com/Orz-3/mini/none/quanX.png', 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/quantumultx.png'] },
      { id: 'Loon', icons: ['https://raw.githubusercontent.com/Orz-3/mini/none/loon.png', 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/loon.png'] },
      { id: 'Shadowrocket', icons: ['https://raw.githubusercontent.com/Orz-3/mini/master/Alpha/shadowrocket.png', 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/shadowrocket.png'] },
      { id: 'Stash', icons: ['https://raw.githubusercontent.com/Orz-3/mini/master/Alpha/stash.png', 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/stash.png'] }
    ],
    chavy: { id: 'ChavyLeung', icon: 'https://avatars3.githubusercontent.com/u/29748519', repo: 'https://github.com/chavyleung/scripts' },
    senku: { id: 'GideonSenku', icon: 'https://avatars1.githubusercontent.com/u/39037656', repo: 'https://github.com/GideonSenku' },
    id77: { id: 'id77', icon: 'https://avatars0.githubusercontent.com/u/9592236', repo: 'https://github.com/id77' },
    orz3: { id: 'Orz-3', icon: 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/Orz-3.png', repo: 'https://github.com/Orz-3/' },
    boxjs: { id: 'BoxJs', show: false, icon: 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/box.png', icons: ['https://raw.githubusercontent.com/Orz-3/mini/master/Alpha/box.png', 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/box.png'], repo: 'https://github.com/chavyleung/scripts' },
    defaultIcons: ['https://raw.githubusercontent.com/Orz-3/mini/master/Alpha/appstore.png', 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/appstore.png']
  }
}

/**
 * 获取内置应用
 */
function getSystemApps() {
  // prettier-ignore
  const sysapps = [
    {
      id: 'BoxSetting',
      name: 'Preferences',
      descs: ['Some scripts that erase data can be executed manually', 'Can set the main color under two themes of light and dark', 'List of configurable wallpapers'],
      keys: [
        '@chavy_boxjs_userCfgs.httpapi',
        '@chavy_boxjs_userCfgs.bgimg',
        '@chavy_boxjs_userCfgs.http_backend',
        '@chavy_boxjs_userCfgs.color_dark_primary',
        '@chavy_boxjs_userCfgs.color_light_primary'
      ],
      settings: [
        { id: '@chavy_boxjs_userCfgs.httpapis', name: 'HTTP-API (Surge)', val: '', type: 'textarea', placeholder: ',examplekey@127.0.0.1:6166', autoGrow: true, rows: 2, persistentHint:true, desc: 'Example: ,examplekey@127.0.0.1:6166! Notice: Start with a comma, Commas separate multiple addresses, Can add carriage return' },
        { id: '@chavy_boxjs_userCfgs.httpapi_timeout', name: 'HTTP-API Timeout (Surge)', val: 20, type: 'number', persistentHint:true, desc: 'If the script author specifies a timeout, The timeout period specified by the script will be used first.' },
        { id: '@chavy_boxjs_userCfgs.http_backend', name: 'HTTP Backend (Quantumult X)', val: '', type: 'text',placeholder: 'http://127.0.0.1:9999', persistentHint:true, desc: 'Example: http://127.0.0.1:9999 ! Notice: Must be based on http Full path starting with, Can be / End' },
        { id: '@chavy_boxjs_userCfgs.bgimgs', name: 'List of background images', val: 'None,\nFollow the system,Follow the system\nlight,http://avi.btstu.cn/sjbz/zsy.php\ndark,https://uploadbeta.com/api/pictures/random\nGirl,http://api.btstu.cn/sjbz/zsy.php', type: 'textarea', placeholder: 'None,{Carriage return} Follow the system,Follow the system{Carriage return} light,The map address{Carriage return} dark,The map address{Carriage return} Girl,The map address', persistentHint:true, autoGrow: true, rows: 2, desc: 'Comma separated name and link, Carriage return separates multiple addresses' },
        { id: '@chavy_boxjs_userCfgs.bgimg', name: 'Background picture', val: '', type: 'text', placeholder: 'http://api.btstu.cn/sjbz/zsy.php', persistentHint:true, desc: 'Enter the online link of the background icon' },
        { id: '@chavy_boxjs_userCfgs.changeBgImgEnterDefault', name: 'Gesture to enter wallpaper mode default background image', val: '', type: 'text', placeholder: 'Fill in the values ​​of the background image list above', persistentHint:true, desc: '' },
        { id: '@chavy_boxjs_userCfgs.changeBgImgOutDefault', name: 'Gesture to exit wallpaper mode Default background image', val: '', type: 'text', placeholder: 'Fill in the values ​​of the background image list above', persistentHint:true, desc: '' },
        { id: '@chavy_boxjs_userCfgs.color_light_primary', name: 'Bright shades', canvas: true, val: '#F7BB0E', type: 'colorpicker', desc: '' },
        { id: '@chavy_boxjs_userCfgs.color_dark_primary', name: 'Dark tone', canvas: true, val: '#2196F3', type: 'colorpicker', desc: '' }
      ],
      scripts: [
        {
          name: "Erase：All caches",
          script: "https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.caches.js"
        },
        {
          name: "Erase：Favorite app",
          script: "https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.usercfgs.favapps.js"
        },
        {
          name: "Erase：User preference",
          script: "https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.usercfgs.js"
        },
        {
          name: "Erase：All sessions",
          script: "https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.usercfgs.sessions.js"
        },
        {
          name: "Erase：All backups",
          script: "https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.baks.js"
        },
        {
          name: "Erase：BoxJs (Pay attention to backup)",
          script: "https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.boxjs.js"
        }
      ],
      author: '@chavyleung',
      repo: 'https://github.com/chavyleung/scripts/blob/master/box/switcher/box.switcher.js',
      icons: [
        'https://raw.githubusercontent.com/chavyleung/scripts/master/box/icons/BoxSetting.mini.png',
        'https://raw.githubusercontent.com/chavyleung/scripts/master/box/icons/BoxSetting.png'
      ]
    },
    {
      id: 'BoxSwitcher',
      name: 'Session switching',
      desc: 'After turning on the silent run, Switching sessions will no longer send system notifications \nNote: Does not affect logging',
      keys: [],
      settings: [{ id: 'CFG_BoxSwitcher_isSilent', name: 'Run silently', val: false, type: 'boolean', desc: 'No system notifications when switching sessions!' }],
      author: '@chavyleung',
      repo: 'https://github.com/chavyleung/scripts/blob/master/box/switcher/box.switcher.js',
      icons: [
        'https://raw.githubusercontent.com/chavyleung/scripts/master/box/icons/BoxSwitcher.mini.png',
        'https://raw.githubusercontent.com/chavyleung/scripts/master/box/icons/BoxSwitcher.png'
      ],
      script: 'https://raw.githubusercontent.com/chavyleung/scripts/master/box/switcher/box.switcher.js'
    },
    {
      "id": "BoxGist",
      "name": "GistBackup",
      "keys": ["@gist.token", "@gist.username"],
      "author": "@dompling",
      "repo": "https://github.com/dompling/Script/tree/master/gist",
      "icons": [
        "https://raw.githubusercontent.com/Former-Years/icon/master/github-bf.png",
        "https://raw.githubusercontent.com/Former-Years/icon/master/github-bf.png"
      ],
      "descs_html": [
        "Wireter <a href='https://github.com/dompling' target='_blank'>@dompling</a> Provide it, Thank!",
        "<br />",
        "<b>Token</b> How to get it:",
        "<span style='margin-left: 40px'>Avatar menu -></span>",
        "<span style='margin-left: 40px'>Settings -></span>",
        "<span style='margin-left: 40px'>Developer settings -></span>",
        "<span style='margin-left: 40px'>Personal access tokens -></span>",
        "<span style='margin-left: 40px'>Generate new token -></span>",
        "<span style='margin-left: 40px'>Find it inside gist Check the submit</span>"
      ],
      "scripts": [
        {
          "name": "Backup Gist",
          "script": "https://raw.githubusercontent.com/dompling/Script/master/gist/backup.js"
        },
        {
          "name": "Follow Gist Resume",
          "script": "https://raw.githubusercontent.com/dompling/Script/master/gist/restore.js"
        }
      ],
      "settings": [
        {
          "id": "@gist.username",
          "name": "User name",
          "val": null,
          "type": "text",
          "placeholder": "github User name",
          "desc": "Required"
        },
        {
          "id": "@gist.token",
          "name": "Personal access tokens",
          "val": null,
          "type": "text",
          "placeholder": "github personal access tokens",
          "desc": "Required"
        }
      ]
    }
  ]
  return sysapps
}

/**
 * 获取用户配置
 */
function getUserCfgs() {
  const defcfgs = {
    favapps: [],
    appsubs: [],
    viewkeys: [],
    isPinedSearchBar: true,
    httpapi: 'examplekey@127.0.0.1:6166',
    http_backend: ''
  }
  const usercfgs = Object.assign(defcfgs, $.getjson($.KEY_usercfgs, {}))

  // 处理异常数据：删除所有为 null 的订阅
  if (usercfgs.appsubs.includes(null)) {
    usercfgs.appsubs = usercfgs.appsubs.filter((sub) => sub)
    $.setjson(usercfgs, $.KEY_usercfgs)
  }

  return usercfgs
}

/**
 * 获取`应用订阅`缓存
 */
function getAppSubCaches() {
  return $.getjson($.KEY_app_subCaches, {})
}

/**
 * 获取全局备份列表
 */
function getGlobalBaks() {
  let backups = $.getjson($.KEY_backups, [])

  // 处理异常数据：删除所有为 null 的备份
  if (backups.includes(null)) {
    backups = backups.filter((bak) => bak)
    $.setjson(backups, $.KEY_backups)
  }

  return backups
}

/**
 * 获取版本清单
 */
function getVersions() {
  return $.http.get($.ver).then(
    (resp) => {
      try {
        $.json = $.toObj(resp.body)
      } catch {
        $.json = {}
      }
    },
    () => ($.json = {})
  )
}

/**
 * 获取用户应用
 */
function getUserApps() {
  // TODO 用户可在 BoxJs 中自定义应用, 格式与应用订阅一致
  return []
}

/**
 * 获取应用会话
 */
function getAppSessions() {
  return $.getjson($.KEY_sessions, []) || []
}

/**
 * 获取当前切换到哪个会话
 */
function getCurSessions() {
  return $.getjson($.KEY_cursessions, {}) || {}
}

/**
 * ===================================
 * 接口类函数
 * ===================================
 */

function getAppDatas(app) {
  const datas = {}
  const nulls = [null, undefined, 'null', 'undefined']
  if (app.keys && Array.isArray(app.keys)) {
    app.keys.forEach((key) => {
      const val = $.getdata(key)
      datas[key] = nulls.includes(val) ? null : val
    })
  }
  if (app.settings && Array.isArray(app.settings)) {
    app.settings.forEach((setting) => {
      const key = setting.id
      const val = $.getdata(key)
      datas[key] = nulls.includes(val) ? null : val
    })
  }
  return datas
}

async function apiSave() {
  const data = $.toObj($request.body)
  if (Array.isArray(data)) {
    data.forEach((dat) => $.setdata(dat.val, dat.key))
  } else {
    $.setdata(data.val, data.key)
  }
  $.json = getBoxData()
}

async function apiAddAppSub() {
  const sub = $.toObj($request.body)
  // 添加订阅
  const usercfgs = getUserCfgs()
  usercfgs.appsubs.push(sub)
  $.setjson(usercfgs, $.KEY_usercfgs)
  // 加载订阅缓存
  await reloadAppSubCache(sub.url)
  $.json = getBoxData()
}

async function apiReloadAppSub() {
  const sub = $.toObj($request.body)
  if (sub) {
    await reloadAppSubCache(sub.url)
  } else {
    await reloadAppSubCaches()
  }
  $.json = getBoxData()
}

async function apiDelGlobalBak() {
  const backup = $.toObj($request.body)
  const backups = $.getjson($.KEY_backups, [])
  const bakIdx = backups.findIndex((b) => b.id === backup.id)
  if (bakIdx > -1) {
    backups.splice(bakIdx, 1)
    $.setdata('', backup.id)
    $.setjson(backups, $.KEY_backups)
  }
  $.json = getBoxData()
}

async function apiUpdateGlobalBak() {
  const { id: backupId, name: backupName } = $.toObj($request.body)
  const backups = $.getjson($.KEY_backups, [])
  const backup = backups.find((b) => b.id === backupId)
  if (backup) {
    backup.name = backupName
    $.setjson(backups, $.KEY_backups)
  }
  $.json = getBoxData()
}

async function apiRevertGlobalBak() {
  const { id: bakcupId } = $.toObj($request.body)
  const backup = $.getjson(bakcupId)
  if (backup) {
    const {
      chavy_boxjs_sysCfgs,
      chavy_boxjs_sysApps,
      chavy_boxjs_sessions,
      chavy_boxjs_userCfgs,
      chavy_boxjs_cur_sessions,
      chavy_boxjs_app_subCaches,
      ...datas
    } = backup
    $.setdata(JSON.stringify(chavy_boxjs_sessions), $.KEY_sessions)
    $.setdata(JSON.stringify(chavy_boxjs_userCfgs), $.KEY_usercfgs)
    $.setdata(JSON.stringify(chavy_boxjs_cur_sessions), $.KEY_cursessions)
    $.setdata(JSON.stringify(chavy_boxjs_app_subCaches), $.KEY_app_subCaches)
    const isNull = (val) =>
      [undefined, null, 'null', 'undefined', ''].includes(val)
    Object.keys(datas).forEach((datkey) =>
      $.setdata(isNull(datas[datkey]) ? '' : `${datas[datkey]}`, datkey)
    )
  }
  const boxdata = getBoxData()
  $.json = boxdata
}

async function apiSaveGlobalBak() {
  const backups = $.getjson($.KEY_backups, [])
  const boxdata = getBoxData()
  const backup = $.toObj($request.body)
  const backupData = {}
  backupData['chavy_boxjs_userCfgs'] = boxdata.usercfgs
  backupData['chavy_boxjs_sessions'] = boxdata.sessions
  backupData['chavy_boxjs_cur_sessions'] = boxdata.curSessions
  backupData['chavy_boxjs_app_subCaches'] = boxdata.appSubCaches
  Object.assign(backupData, boxdata.datas)
  backups.push(backup)
  $.setjson(backups, $.KEY_backups)
  $.setjson(backupData, backup.id)
  $.json = getBoxData()
}

async function apiImpGlobalBak() {
  const backups = $.getjson($.KEY_backups, [])
  const backup = $.toObj($request.body)
  const backupData = backup.bak
  delete backup.bak
  backups.push(backup)
  $.setjson(backups, $.KEY_backups)
  $.setjson(backupData, backup.id)
  $.json = getBoxData()
}

async function apiRunScript() {
  // 取消勿扰模式
  $.isMute = false
  const opts = $.toObj($request.body)
  const httpapi = $.getdata('@chavy_boxjs_userCfgs.httpapi')
  const ishttpapi = /.*?@.*?:[0-9]+/.test(httpapi)
  let script_text = null
  if (opts.isRemote) {
    await $.getScript(opts.url).then((script) => (script_text = script))
  } else {
    script_text = opts.script
  }
  if (
    $.isSurge() &&
    !$.isLoon() &&
    !$.isShadowrocket() &&
    !$.isStash() &&
    ishttpapi
  ) {
    const runOpts = { timeout: opts.timeout }
    await $.runScript(script_text, runOpts).then(
      (resp) => ($.json = JSON.parse(resp))
    )
  } else {
    await new Promise((resolve) => {
      $eval_env.resolve = resolve
      // 避免被执行脚本误认为是 rewrite 环境
      // 所以需要 `$request = undefined`
      $eval_env.request = $request
      $request = undefined
      // 重写 console.log, 把日志记录到 $eval_env.cached_logs
      $eval_env.cached_logs = []
      console.cloned_log = console.log
      console.log = (l) => {
        console.cloned_log(l)
        $eval_env.cached_logs.push(l)
      }
      // 重写脚本内的 $done, 调用 $done() 即是调用 $eval_env.resolve()
      script_text = script_text.replace(/\$done/g, '$eval_env.resolve')
      script_text = script_text.replace(/\$\.done/g, '$eval_env.resolve')
      try {
        eval(script_text)
      } catch (e) {
        $eval_env.cached_logs.push(e)
        resolve()
      }
    })
    // 还原 console.log
    console.log = console.cloned_log
    // 还原 $request
    $request = $eval_env.request
    // 返回数据
    $.json = {
      result: '',
      output: $eval_env.cached_logs.join('\n')
    }
  }
}

async function apiSaveData() {
  const { key: dataKey, val: dataVal } = $.toObj($request.body)
  $.setdata(dataVal, dataKey)
  $.json = {
    key: dataKey,
    val: $.getdata(dataKey)
  }
}

/**
 * ===================================
 * 工具类函数
 * ===================================
 */

function reloadAppSubCache(url) {
  // 地址后面拼时间缀, 避免 GET 缓存
  const requrl = `${url}${url.includes('?') ? '&' : '?'}_=${new Date().getTime()}`
  return $.http.get(requrl).then((resp) => {
    try {
      const subcaches = getAppSubCaches()
      subcaches[url] = $.toObj(resp.body)
      subcaches[url].updateTime = new Date()
      $.setjson(subcaches, $.KEY_app_subCaches)
      $.log(`Update subscriptions, Successes! ${url}`)
    } catch (e) {
      $.logErr(e)
      $.log(`Update subscriptions, Be defeated! ${url}`)
    }
  })
}

async function reloadAppSubCaches() {
  $.msg($.name, 'Update subscriptions: Begin!')
  const reloadActs = []
  const usercfgs = getUserCfgs()
  usercfgs.appsubs.forEach((sub) => {
    reloadActs.push(reloadAppSubCache(sub.url))
  })
  await Promise.all(reloadActs)
  $.log(`Subscribe to all, Finished!`)
  const endTime = new Date().getTime()
  const costTime = (endTime - $.startTime) / 1000
  $.msg($.name, `Update subscriptions: Finished! 🕛 ${costTime} Seconds`)
}

function upgradeUserData() {
  const usercfgs = getUserCfgs()
  // 如果存在`usercfgs.appsubCaches`则需要升级数据
  const isNeedUpgrade = !!usercfgs.appsubCaches
  if (isNeedUpgrade) {
    // 迁移订阅缓存至独立的持久化空间
    $.setjson(usercfgs.appsubCaches, $.KEY_app_subCaches)
    // 移除用户偏好中的订阅缓存
    delete usercfgs.appsubCaches
    usercfgs.appsubs.forEach((sub) => {
      delete sub._raw
      delete sub.apps
      delete sub.isErr
      delete sub.updateTime
    })
  }
  if (isNeedUpgrade) {
    $.setjson(usercfgs, $.KEY_usercfgs)
  }
}

/**
 * 升级备份数据
 *
 * 升级前: 把所有备份都存到一个持久化空间
 * 升级后: 把每个备份都独立存到一个空间, `$.KEY_backups` 仅记录必要的数据索引
 */
function upgradeGlobalBaks() {
  let oldbaks = $.getdata($.KEY_globalBaks)
  let newbaks = $.getjson($.KEY_backups, [])
  const isEmpty = (bak) => [undefined, null, ''].includes(bak)
  const isExistsInNew = (backupId) => newbaks.find((bak) => bak.id === backupId)

  // 存在旧备份数据时, 升级备份数据格式
  if (!isEmpty(oldbaks)) {
    oldbaks = JSON.parse(oldbaks)
    oldbaks.forEach((bak) => {
      if (isEmpty(bak)) return
      if (isEmpty(bak.bak)) return
      if (isExistsInNew(bak.id)) return

      console.log(`Migrating: ${bak.name}`)
      const backupId = bak.id
      const backupData = bak.bak

      // 删除旧的备份数据, 仅保留索引信息
      delete bak.bak
      newbaks.push(bak)

      // 提取旧备份数据, 存入独立的持久化空间
      $.setjson(backupData, backupId)
    })
    $.setjson(newbaks, $.KEY_backups)
  }

  // 清空所有旧备份的数据
  $.setdata('', $.KEY_globalBaks)
}

/**
 * ===================================
 * 结束类函数
 * ===================================
 */
function doneBox() {
  // 记录当前使用哪个域名访问
  $.setdata(getHost($request.url), $.KEY_boxjs_host)
  if ($.isOptions) doneOptions()
  else if ($.isPage) donePage()
  else if ($.isQuery) doneQuery()
  else if ($.isApi) doneApi()
  else $.done()
}

function getBaseDoneHeaders(mixHeaders = {}) {
  return Object.assign(
    {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,GET,OPTIONS,PUT,DELETE',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
    },
    mixHeaders
  )
}

function getHtmlDoneHeaders() {
  return getBaseDoneHeaders({
    'Content-Type': 'text/html;charset=UTF-8'
  })
}
function getJsonDoneHeaders() {
  return getBaseDoneHeaders({
    'Content-Type': 'text/json; charset=utf-8'
  })
}

function doneOptions() {
  const headers = getBaseDoneHeaders()
  if ($.isSurge() || $.isLoon()) {
    $.done({ response: { headers } })
  } else if ($.isQuanX()) {
    $.done({ headers })
  }
}

function donePage() {
  const headers = getHtmlDoneHeaders()
  if ($.isSurge() || $.isLoon()) {
    $.done({ response: { status: 200, headers, body: $.html } })
  } else if ($.isQuanX()) {
    $.done({ status: 'HTTP/1.1 200', headers, body: $.html })
  }
}

function doneQuery() {
  $.json = $.toStr($.json)
  const headers = getJsonDoneHeaders()
  if ($.isSurge() || $.isLoon()) {
    $.done({ response: { status: 200, headers, body: $.json } })
  } else if ($.isQuanX()) {
    $.done({ status: 'HTTP/1.1 200', headers, body: $.json })
  }
}

function doneApi() {
  $.json = $.toStr($.json)
  const headers = getJsonDoneHeaders()
  if ($.isSurge() || $.isLoon()) {
    $.done({ response: { status: 200, headers, body: $.json } })
  } else if ($.isQuanX()) {
    $.done({ status: 'HTTP/1.1 200', headers, body: $.json })
  }
}

/**
 * GistBox by https://github.com/Peng-YM
 */
// prettier-ignore
function GistBox(e){const t=function(e,t={}){const{isQX:s,isLoon:n,isSurge:o}=function(){const e="undefined"!=typeof $task,t="undefined"!=typeof $loon,s="undefined"!=typeof $httpClient&&!this.isLoon,n="function"==typeof require&&"undefined"!=typeof $jsbox;return{isQX:e,isLoon:t,isSurge:s,isNode:"function"==typeof require&&!n,isJSBox:n}}(),r={};return["GET","POST","PUT","DELETE","HEAD","OPTIONS","PATCH"].forEach(i=>r[i.toLowerCase()]=(r=>(function(r,i){(i="string"==typeof i?{url:i}:i).url=e?e+i.url:i.url;const a=(i={...t,...i}).timeout,u={onRequest:()=>{},onResponse:e=>e,onTimeout:()=>{},...i.events};let c,d;u.onRequest(r,i),c=s?$task.fetch({method:r,...i}):new Promise((e,t)=>{(o||n?$httpClient:require("request"))[r.toLowerCase()](i,(s,n,o)=>{s?t(s):e({statusCode:n.status||n.statusCode,headers:n.headers,body:o})})});const f=a?new Promise((e,t)=>{d=setTimeout(()=>(u.onTimeout(),t(`${r} URL: ${i.url} exceeds the timeout ${a} ms`)),a)}):null;return(f?Promise.race([f,c]).then(e=>(clearTimeout(d),e)):c).then(e=>u.onResponse(e))})(i,r))),r}("https://api.github.com",{headers:{Authorization:`token ${e}`,"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.141 Safari/537.36"},events:{onResponse:e=>String(e.statusCode).startsWith("4")?Promise.reject(`ERROR: ${JSON.parse(e.body).message}`):e}}),s=e=>`boxjs.bak.${e}.json`,n=e=>e.match(/boxjs\.bak\.(\d+)\.json/)[1];return new class{async findDatabase(){return t.get("/gists").then(e=>{const t=JSON.parse(e.body);for(let e of t)if("BoxJs Gist"===e.description)return e.id;return-1})}async createDatabase(e){e instanceof Array||(e=[e]);const n={};return e.forEach(e=>{n[s(e.time)]={content:e.content}}),t.post({url:"/gists",body:JSON.stringify({description:"BoxJs Gist",public:!1,files:n})}).then(e=>JSON.parse(e.body).id)}async deleteDatabase(e){return t.delete(`/gists/${e}`)}async getBackups(e){const s=await t.get(`/gists/${e}`).then(e=>JSON.parse(e.body)),{files:o}=s,r=[];for(let e of Object.keys(o))r.push({time:n(e),url:o[e].raw_url});return r}async addBackups(e,t){t instanceof Array||(t=[t]);const n={};return t.forEach(e=>n[s(e.time)]={content:e.content}),this.updateBackups(e,n)}async deleteBackups(e,t){t instanceof Array||(t=[t]);const n={};return t.forEach(e=>n[s(e)]={}),this.updateBackups(e,n)}async updateBackups(e,s){return t.patch({url:`/gists/${e}`,body:JSON.stringify({files:s})})}}}

/**
 * EnvJs
 */
// prettier-ignore
function Env(t,e){class s{constructor(t){this.env=t}send(t,e="GET"){t="string"==typeof t?{url:t}:t;let s=this.get;return"POST"===e&&(s=this.post),new Promise((e,i)=>{s.call(this,t,(t,s,r)=>{t?i(t):e(s)})})}get(t){return this.send.call(this.env,t)}post(t){return this.send.call(this.env,t,"POST")}}return new class{constructor(t,e){this.name=t,this.http=new s(this),this.data=null,this.dataFile="box.dat",this.logs=[],this.isMute=!1,this.isNeedRewrite=!1,this.logSeparator="\n",this.encoding="utf-8",this.startTime=(new Date).getTime(),Object.assign(this,e),this.log("",`\ud83d\udd14${this.name}, \u5f00\u59cb!`)}isNode(){return"undefined"!=typeof module&&!!module.exports}isQuanX(){return"undefined"!=typeof $task}isSurge(){return"undefined"!=typeof $httpClient&&"undefined"==typeof $loon}isLoon(){return"undefined"!=typeof $loon}isShadowrocket(){return"undefined"!=typeof $rocket}isStash(){return"undefined"!=typeof $environment&&$environment["stash-version"]}toObj(t,e=null){try{return JSON.parse(t)}catch{return e}}toStr(t,e=null){try{return JSON.stringify(t)}catch{return e}}getjson(t,e){let s=e;const i=this.getdata(t);if(i)try{s=JSON.parse(this.getdata(t))}catch{}return s}setjson(t,e){try{return this.setdata(JSON.stringify(t),e)}catch{return!1}}getScript(t){return new Promise(e=>{this.get({url:t},(t,s,i)=>e(i))})}runScript(t,e){return new Promise(s=>{let i=this.getdata("@chavy_boxjs_userCfgs.httpapi");i=i?i.replace(/\n/g,"").trim():i;let r=this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");r=r?1*r:20,r=e&&e.timeout?e.timeout:r;const[o,h]=i.split("@"),n={url:`http://${h}/v1/scripting/evaluate`,body:{script_text:t,mock_type:"cron",timeout:r},headers:{"X-Key":o,Accept:"*/*"}};this.post(n,(t,e,i)=>s(i))}).catch(t=>this.logErr(t))}loaddata(){if(!this.isNode())return{};{this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e);if(!s&&!i)return{};{const i=s?t:e;try{return JSON.parse(this.fs.readFileSync(i))}catch(t){return{}}}}}writedata(){if(this.isNode()){this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e),r=JSON.stringify(this.data);s?this.fs.writeFileSync(t,r):i?this.fs.writeFileSync(e,r):this.fs.writeFileSync(t,r)}}lodash_get(t,e,s){const i=e.replace(/\[(\d+)\]/g,".$1").split(".");let r=t;for(const t of i)if(r=Object(r)[t],void 0===r)return s;return r}lodash_set(t,e,s){return Object(t)!==t?t:(Array.isArray(e)||(e=e.toString().match(/[^.[\]]+/g)||[]),e.slice(0,-1).reduce((t,s,i)=>Object(t[s])===t[s]?t[s]:t[s]=Math.abs(e[i+1])>>0==+e[i+1]?[]:{},t)[e[e.length-1]]=s,t)}getdata(t){let e=this.getval(t);if(/^@/.test(t)){const[,s,i]=/^@(.*?)\.(.*?)$/.exec(t),r=s?this.getval(s):"";if(r)try{const t=JSON.parse(r);e=t?this.lodash_get(t,i,""):e}catch(t){e=""}}return e}setdata(t,e){let s=!1;if(/^@/.test(e)){const[,i,r]=/^@(.*?)\.(.*?)$/.exec(e),o=this.getval(i),h=i?"null"===o?null:o||"{}":"{}";try{const e=JSON.parse(h);this.lodash_set(e,r,t),s=this.setval(JSON.stringify(e),i)}catch(e){const o={};this.lodash_set(o,r,t),s=this.setval(JSON.stringify(o),i)}}else s=this.setval(t,e);return s}getval(t){return this.isSurge()||this.isLoon()?$persistentStore.read(t):this.isQuanX()?$prefs.valueForKey(t):this.isNode()?(this.data=this.loaddata(),this.data[t]):this.data&&this.data[t]||null}setval(t,e){return this.isSurge()||this.isLoon()?$persistentStore.write(t,e):this.isQuanX()?$prefs.setValueForKey(t,e):this.isNode()?(this.data=this.loaddata(),this.data[e]=t,this.writedata(),!0):this.data&&this.data[e]||null}initGotEnv(t){this.got=this.got?this.got:require("got"),this.cktough=this.cktough?this.cktough:require("tough-cookie"),this.ckjar=this.ckjar?this.ckjar:new this.cktough.CookieJar,t&&(t.headers=t.headers?t.headers:{},void 0===t.headers.Cookie&&void 0===t.cookieJar&&(t.cookieJar=this.ckjar))}get(t,e=(()=>{})){if(t.headers&&(delete t.headers["Content-Type"],delete t.headers["Content-Length"]),this.isSurge()||this.isLoon())this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient.get(t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status),e(t,s,i)});else if(this.isQuanX())this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t));else if(this.isNode()){let s=require("iconv-lite");this.initGotEnv(t),this.got(t).on("redirect",(t,e)=>{try{if(t.headers["set-cookie"]){const s=t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString();s&&this.ckjar.setCookieSync(s,null),e.cookieJar=this.ckjar}}catch(t){this.logErr(t)}}).then(t=>{const{statusCode:i,statusCode:r,headers:o,rawBody:h}=t;e(null,{status:i,statusCode:r,headers:o,rawBody:h},s.decode(h,this.encoding))},t=>{const{message:i,response:r}=t;e(i,r,r&&s.decode(r.rawBody,this.encoding))})}}post(t,e=(()=>{})){const s=t.method?t.method.toLocaleLowerCase():"post";if(t.body&&t.headers&&!t.headers["Content-Type"]&&(t.headers["Content-Type"]="application/x-www-form-urlencoded"),t.headers&&delete t.headers["Content-Length"],this.isSurge()||this.isLoon())this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient[s](t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status),e(t,s,i)});else if(this.isQuanX())t.method=s,this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t));else if(this.isNode()){let i=require("iconv-lite");this.initGotEnv(t);const{url:r,...o}=t;this.got[s](r,o).then(t=>{const{statusCode:s,statusCode:r,headers:o,rawBody:h}=t;e(null,{status:s,statusCode:r,headers:o,rawBody:h},i.decode(h,this.encoding))},t=>{const{message:s,response:r}=t;e(s,r,r&&i.decode(r.rawBody,this.encoding))})}}time(t,e=null){const s=e?new Date(e):new Date;let i={"M+":s.getMonth()+1,"d+":s.getDate(),"H+":s.getHours(),"m+":s.getMinutes(),"s+":s.getSeconds(),"q+":Math.floor((s.getMonth()+3)/3),S:s.getMilliseconds()};/(y+)/.test(t)&&(t=t.replace(RegExp.$1,(s.getFullYear()+"").substr(4-RegExp.$1.length)));for(let e in i)new RegExp("("+e+")").test(t)&&(t=t.replace(RegExp.$1,1==RegExp.$1.length?i[e]:("00"+i[e]).substr((""+i[e]).length)));return t}msg(e=t,s="",i="",r){const o=t=>{if(!t)return t;if("string"==typeof t)return this.isLoon()?t:this.isQuanX()?{"open-url":t}:this.isSurge()?{url:t}:void 0;if("object"==typeof t){if(this.isLoon()){let e=t.openUrl||t.url||t["open-url"],s=t.mediaUrl||t["media-url"];return{openUrl:e,mediaUrl:s}}if(this.isQuanX()){let e=t["open-url"]||t.url||t.openUrl,s=t["media-url"]||t.mediaUrl,i=t["update-pasteboard"]||t.updatePasteboard;return{"open-url":e,"media-url":s,"update-pasteboard":i}}if(this.isSurge()){let e=t.url||t.openUrl||t["open-url"];return{url:e}}}};if(this.isMute||(this.isSurge()||this.isLoon()?$notification.post(e,s,i,o(r)):this.isQuanX()&&$notify(e,s,i,o(r))),!this.isMuteLog){let t=["","==============\ud83d\udce3\u7cfb\u7edf\u901a\u77e5\ud83d\udce3=============="];t.push(e),s&&t.push(s),i&&t.push(i),console.log(t.join("\n")),this.logs=this.logs.concat(t)}}log(...t){t.length>0&&(this.logs=[...this.logs,...t]),console.log(t.join(this.logSeparator))}logErr(t,e){const s=!this.isSurge()&&!this.isQuanX()&&!this.isLoon();s?this.log("",`\u2757\ufe0f${this.name}, \u9519\u8bef!`,t.stack):this.log("",`\u2757\ufe0f${this.name}, \u9519\u8bef!`,t)}wait(t){return new Promise(e=>setTimeout(e,t))}done(t={}){const e=(new Date).getTime(),s=(e-this.startTime)/1e3;this.log("",`\ud83d\udd14${this.name}, \u7ed3\u675f! \ud83d\udd5b ${s} \u79d2`),this.log(),(this.isSurge()||this.isQuanX()||this.isLoon())&&$done(t)}}(t,e)}
