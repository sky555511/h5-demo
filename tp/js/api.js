/**
 * api.js — 接口封装层（对接后端 etrace）
 *
 * 所有后端交互集中在此文件：登录 / 退出、当前用户、医院科室、器械包、器械库、
 * 订单列表 / 详情 / 下单。接口路径与参数对齐 etrace-html 与后端 etrace 项目。
 *
 * 登录协议：
 *  - POST /user/login，账号密码按与后端约定的算法加密后放入 Basic Auth，
 *    token 在响应 message 字段；后续请求经请求头 u-token 传递。
 */
window.API = (function () {
  'use strict'

  var CONFIG = {
    baseURL: '/api', // 后端接口根地址
    timeout: 15000,            // 请求超时（ms）

    sessionKey: 'h5_out_user', // 登录态 localStorage key

    // token 失效回调（401/403 时触发，app.js 用于跳回登录页）
    onAuthFail: null,

    // 接口路径（对齐 etrace-html / 后端 etrace 项目）
    urls: {
      login: '/user/login',               // POST 登录（Basic Auth + AES 账号密码，token 在响应 message）
      logout: '/user/logout',             // POST 退出（body: { message: token }）
      getUserByToken: '/user/getUserByToken', // GET 当前登录用户信息（u-token 头，返回 UserModel）
      getFunctionsByToken: '/user/getFunctionsByToken', // GET 当前用户菜单/功能权限（对齐 etrace-html 侧边栏）
      hospitals: '/hospital/list',               // GET 医院列表（ListPageDto）
      departments: '/department/listByHospital', // GET 科室列表（按医院，isOperationRoom=true）
      packages: '/package/list',                 // GET 器械包检索（ifOut=true + 当前供应商）
      getPackageCompositions: '/package/getPackageCompositions', // GET 包组成明细
      allInstruments: '/instrument/list',        // GET 器械库（isRentInstrument=true + 供应商名称）
      getOutInstrumentOrder: '/out/getOutInstrumentOrder', // GET 订单主信息（编辑回填）
      getOutOrderDetailList: '/out/getOutOrderDetailList', // GET 订单分包明细（编辑回填）
      orderList: '/out/getOutOrderList', // GET 订单列表（ListPageDto{total,list}）
      saveOrder: '/out/saveOrUpdateOutOrder'   // POST 下单（body: { outInstrumentOrder, outPackages }）
    },

    // 订单二维码内容：默认订单号（与网页版一致）；如需扫码回跳地址可改为
    // 如 'https://xxx/outOrder/detail/' + order.serialNumber
    qrText: function (order) {
      return order.serialNumber
    },

    // H5 对应网页版「外来器械订单管理」，登录后必须持有该菜单权限
    requiredPagePath: '/process/outPackage/outOrderManage'
  }

  // 登录凭据传输加密（AES-128-ECB/PKCS5；crypto-js Pkcs7 与后端 PKCS5Padding 兼容）
  // 密钥不在源码中以明文出现，运行时还原后与后端约定值一致
  function decodeTransportKey () {
    var cipher = [198, 15, 68, 219, 46, 41, 183, 185, 59, 162, 100, 209, 79, 168, 88, 198]
    var mask = [165, 60, 113, 226, 75, 25, 214, 136, 95, 195, 7, 180, 46, 154, 97, 240]
    var out = ''
    for (var i = 0; i < cipher.length; i++) out += String.fromCharCode(cipher[i] ^ mask[i])
    return out
  }
  function aesEncrypt (text) {
    var k = CryptoJS.enc.Utf8.parse(decodeTransportKey())
    return CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text), k, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    }).ciphertext.toString(CryptoJS.enc.Base64)
  }

  /* ============================================================
   * 工具
   * ============================================================ */
  function clone (x) { return JSON.parse(JSON.stringify(x)) }

  // 数量按后台原样：0 / 空值都是 0，不默认成 1
  function parseNum (v, fallback) {
    if (fallback === undefined) fallback = 0
    if (v === undefined || v === null || v === '') return fallback
    var n = parseInt(v, 10)
    return isNaN(n) ? fallback : n
  }

  function qs (obj) {
    var parts = []
    for (var k in obj) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
      }
    }
    return parts.join('&')
  }

  // 毫秒时间戳 → 'YYYY-MM-DD HH:mm'（h5 展示/筛选统一格式）
  function formatTime (ts) {
    if (!ts && ts !== 0) return ''
    var d = new Date(Number(ts))
    if (isNaN(d.getTime())) return ''
    function p (n) { return n < 10 ? '0' + n : '' + n }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  }

  // h5 筛选条件 → 后端时间范围
  // 注意：后端不传时间参数时默认只查"今天零点之后"，因此 'all' 需显式传很早的起点（2018-01-01，与 etrace-html 一致）；
  // endTime 传"明天零点"保证包含今天全天（后端为 <= 比较）
  function toRange (f) {
    var now = new Date()
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    var tomorrowStart = new Date(todayStart.getTime() + 86400000)
    function fmt (d) {
      function p (n) { return n < 10 ? '0' + n : '' + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    }
    if (!f || !f.timeRange || f.timeRange === 'all') {
      return { startTime: '2018-01-01 00:00:00', endTime: fmt(tomorrowStart) }
    }
    var days = { today: 0, '7d': 6, '30d': 29 }[f.timeRange]
    var start = new Date(todayStart.getTime() - (days || 0) * 86400000)
    return { startTime: fmt(start), endTime: fmt(tomorrowStart) }
  }

  /* ============================================================
   * 会话（登录态：token + 用户/供应商信息）
   * ============================================================ */
  function getSession () {
    try {
      var raw = localStorage.getItem(CONFIG.sessionKey)
      return raw ? JSON.parse(raw) : null
    } catch (e) { return null }
  }
  function setSession (s) {
    try { localStorage.setItem(CONFIG.sessionKey, JSON.stringify(s)) } catch (e) { /* file:// 下忽略 */ }
  }
  function clearSession () {
    try { localStorage.removeItem(CONFIG.sessionKey) } catch (e) {}
  }

  /* ============================================================
   * HTTP 请求封装
   * 后端约定：成功 = HTTP 2xx + 各接口自有响应结构；失败 = HTTP 4xx/5xx + 错误文本/JSON；
   * 登录态经请求头 u-token 传递（与 etrace-html 一致）。
   * ============================================================ */
  function request (method, url, data, extraHeaders) {
    var session = getSession()
    var headers = { 'Content-Type': 'application/json' }
    if (session && session.token) headers['u-token'] = session.token
    if (extraHeaders) {
      Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k] })
    }

    var opts = { method: method, headers: headers }
    if (data !== undefined) opts.body = JSON.stringify(data)

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    if (ctrl) {
      opts.signal = ctrl.signal
      setTimeout(function () { ctrl.abort() }, CONFIG.timeout)
    }

    return fetch((String(CONFIG.baseURL || '').replace(/\/+$/, '')) + url, opts).then(function (res) {
      return res.text().then(function (text) {
        var body = null
        if (text) {
          try { body = JSON.parse(text) } catch (e) { body = text } // 后端错误可能为纯文本
        } else {
          body = {}
        }
        if (!res.ok) {
          // 失败：HTTP 4xx/5xx，body 为错误信息（文本或 { message }）
          var msg = body && typeof body === 'object'
            ? (body.message || body.msg || JSON.stringify(body))
            : (body || '请求失败（HTTP ' + res.status + '）')
          if (res.status === 401 || res.status === 403) {
            clearSession() // token 失效：清登录态
            if (typeof CONFIG.onAuthFail === 'function') CONFIG.onAuthFail()
          }
          throw { code: res.status, message: msg }
        }
        return body
      })
    }).catch(function (e) {
      if (e && e.name === 'AbortError') throw { message: '请求超时，请稍后重试' }
      if (e && e.message) throw e
      throw { message: '网络异常，请检查后端服务' }
    })
  }

  /* ============================================================
   * 接口定义
   * ============================================================ */

  /** 登录：成功返回 { token, user }，失败 reject { message } */
  function login (account, password) {
    // 账号密码 AES-ECB 加密后放入 Basic Auth（对齐 etrace-html src/api/login.js）
    var encUser = aesEncrypt(account)
    var encPwd = aesEncrypt(password)
    var auth = btoa(encUser + ':' + encPwd)
    return request('POST', CONFIG.urls.login, { pcname: null, captcha: null }, {
      Authorization: 'Basic ' + auth
    }).then(function (body) {
      var token = (body && (body.message || body.token)) || ''
      if (!token) throw { message: '登录失败：未获取到 token' }
      // 先存 token（后续接口需经 u-token 头传递），再校验页面权限并拉取用户信息
      setSession({ token: token, account: account })
      return assertOutOrderPermission().then(function () {
        return getUserByToken().then(function (user) {
          var info = mapUserModel(user)
          setSession(Object.assign({ token: token, account: account }, info))
          return { token: token, user: info }
        }).catch(function (e) {
          // 用户信息获取失败不阻断登录（token 与页面权限已校验），会话保留基础信息
          return { token: token, user: { account: account } }
        })
      })
    })
  }

  /** 退出登录 */
  function logout () {
    var session = getSession()
    return request('POST', CONFIG.urls.logout, { message: session ? session.token : '' })
      .catch(function () { /* 忽略退出失败 */ })
      .then(function () { clearSession() })
  }

  // UserModel → h5 会话用户信息（供应商外网端按供应商隔离；医院用户 supplierModel 为 null）
  function mapUserModel (u) {
    if (!u) return {}
    var supplier = u.supplierModel || {}
    return {
      userId: u.id,
      username: u.username,
      name: u.name,
      ifSupplierUser: u.ifSupplierUser === true,
      supplierId: supplier.id != null ? supplier.id : null,
      supplierName: supplier.name || u.unitName || '',
      supplierCode: supplier.code || '',
      unitName: u.unitName || '',
      hospitalId: u.hospitalId != null ? u.hospitalId : null,
      activeDepartmentId: u.activeDepartmentId != null ? u.activeDepartmentId : null
    }
  }

  /** 当前登录用户信息（对齐 /user/getUserByToken，返回 UserModel） */
  function getUserByToken () {
    return request('GET', CONFIG.urls.getUserByToken)
  }

  /** 当前用户菜单/功能权限（对齐 /user/getFunctionsByToken，返回 { pages, functions }） */
  function getFunctionsByToken () {
    return request('GET', CONFIG.urls.getFunctionsByToken)
  }

  // 从 getFunctionsByToken 的 pages 树收集完整 path（对齐 etrace-html Sidebar.initAuthPath）
  function collectAuthPaths (pages, parentPath, out) {
    ;(pages || []).forEach(function (item) {
      var path = (parentPath || '') + (item.level === 1 ? '' : '/') + item.path
      out.push(path)
      if (item.children && item.children.length > 0) {
        collectAuthPaths(item.children, path, out)
      }
    })
  }

  /**
   * 校验当前 token 是否具备 H5 对应网页版菜单权限。
   * 无权限时清会话并 reject，避免医院用户/无菜单账号进入供应商端。
   */
  function assertOutOrderPermission () {
    return getFunctionsByToken().then(function (res) {
      var paths = []
      collectAuthPaths(res && res.pages, null, paths)
      var required = CONFIG.requiredPagePath
      var ok = paths.indexOf(required) > -1
      if (!ok) {
        var session = getSession()
        var token = session && session.token
        clearSession()
        if (token) {
          request('POST', CONFIG.urls.logout, { message: token }).catch(function () { /* 忽略 */ })
        }
        throw { message: '暂无访问权限' }
      }
      return res
    }).catch(function (e) {
      if (e && e.message === '暂无访问权限') throw e
      clearSession()
      throw { message: (e && e.message) || '权限校验失败' }
    })
  }

  /** 医院列表（/hospital/list，扁平 {id, name}） */
  function getHospitals () {
    return request('GET', CONFIG.urls.hospitals + '?nameOrCode=&page=1&pageSize=999').then(function (res) {
      return ((res && res.list) || []).map(function (h) { return { id: h.id, name: h.name, code: h.code } })
    })
  }

  /** 使用科室（按医院，/department/listByHospital?isOperationRoom=true） */
  function getDepartments (hospitalId) {
    return request('GET', CONFIG.urls.departments + '?' + qs({
      nameOrCode: '', hospitalId: hospitalId, page: 1, pageSize: 999, isOperationRoom: true
    })).then(function (res) {
      return ((res && res.list) || []).map(function (d) { return { id: d.id, name: d.name, code: d.code } })
    })
  }

  /** 器械包模板列表（/package/list?ifOut=true + 当前供应商；包列表不含组成，选包时调 getPackageCompositions） */
  function getPackages (nameOrCode) {
    var session = getSession()
    var query = {
      nameOrCode: nameOrCode || '',
      ifOut: true,
      supplierId: session && session.supplierId != null ? session.supplierId : undefined, // 当前登录供应商
      page: 1,
      pageSize: 999
    }
    return request('GET', CONFIG.urls.packages + '?' + qs(query)).then(function (res) {
      return ((res && res.list) || []).map(function (p) {
        return {
          id: p.id,
          name: p.name,
          code: p.code,
          pinyin: p.pinyin || p.pinYin || p.py || p.spell || p.jianPin || p.jianpin || p.firstLetter || '',
          compositions: []
        }
      })
    })
  }

  /** 包组成明细（/package/getPackageCompositions，返回 h5 器械数组） */
  function getPackageCompositions (packageTemplateId) {
    return request('GET', CONFIG.urls.getPackageCompositions + '?packageTemplateId=' + encodeURIComponent(packageTemplateId)).then(function (res) {
      var list = Array.isArray(res) ? res : ((res && res.list) || [])
      return list.map(normalizeComposition)
    })
  }

  function firstNonEmpty () {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i]
      if (v !== undefined && v !== null && v !== '') return v
    }
    return ''
  }

  function isTypeCode (v) {
    var s = String(v || '')
    return !s || s.indexOf('COMP_') === 0 || s === '器械' || s === '植入物' || s === '电动工具' || s === '辅助材料'
  }

  /** 全部器械库（/instrument/list?isRentInstrument=true + 供应商名称 unitName） */
  function getAllInstruments () {
    var session = getSession()
    return request('GET', CONFIG.urls.allInstruments + '?' + qs({
      nameOrCode: '',
      dataFlag: true,
      page: 1,
      pageSize: 999,
      isRentInstrument: true,
      unitNameOrCode: (session && session.unitName) || undefined // 供应商名称（医院用户联调时缺省）
    })).then(function (res) {
      var list = Array.isArray(res) ? res : ((res && res.list) || [])
      return list.map(function (item) {
        // 器械库主键是 instrumentId，不能当成 compositionId；先记下来供编辑回填兜底匹配
        if (item && item.instrumentId == null && item.id != null) item.instrumentId = item.id
        return normalizeComposition(item)
      })
    })
  }

  // 后端器械 → h5 器械结构（compositionModel 嵌套；植入物/电动工具按 hasImplant/electricTool 标志，与网页版一致）
  // 注意：包组成接口会额外返回 instrumentId（器械库 id），不能拿它当 compositionId，否则提交后再编辑会对不上、规格型号也会丢。
  function normalizeComposition (c) {
    if (!c) {
      return { compositionId: null, instrumentId: null, applianceName: '', specifical: '', model: '', type: '器械', num: 0 }
    }
    var cm = c.compositionModel || {}
    var inst = c.instrumentModel || cm.instrumentModel || {}
    var prop = cm.compositionProperty || c.compositionProperty || {}
    var type = '器械'
    if (cm.electricTool || c.electricTool || c.isElectricTool || inst.electricTool) type = '电动工具'
    else if (cm.hasImplant || c.hasImplant || c.implants) type = '植入物'
    else if (prop.code === 'COMP_ASSIST' || prop.code === 'COMP_DISPO') type = '辅助材料'
    var model = firstNonEmpty(c.model, cm.model, inst.model, inst.type)
    if (!model && !isTypeCode(c.type)) model = c.type
    return {
      compositionId: c.compositionId != null ? c.compositionId : (cm.id != null ? cm.id : null),
      instrumentId: c.instrumentId != null ? c.instrumentId : (inst.id != null ? inst.id : null),
      applianceName: firstNonEmpty(c.applianceName, cm.name, c.name, inst.name),
      specifical: firstNonEmpty(c.specifical, cm.specifical, inst.specifical),
      model: model,
      type: type,
      num: parseNum(c.num != null && c.num !== '' ? c.num : cm.num, 0)
    }
  }

  function sumCounts (list) {
    var total = { applianceNum: 0, implantsNum: 0, electricToolNum: 0 }
    ;(list || []).forEach(function (c) {
      var n = parseInt(c.num, 10) || 0
      if (c.type === '电动工具') total.electricToolNum += n
      else if (c.type === '植入物') total.implantsNum += n
      else if (c.type === '辅助材料') { /* 辅助材料不计入统计 */ }
      else total.applianceNum += n
    })
    return total
  }

  // 分包明细 → h5 subpackage 结构（分包序号统一为「第N号分包」）
  function normalizeOrderDetail (item, index) {
    var comps = (item.compositions || []).map(normalizeComposition)
    var counts = sumCounts(comps)
    var pkgId = item.packageTemplateId || (item.packageModel && item.packageModel.id)
    var pkgName = item.packageTemplateName || item.packageName || (item.packageModel && item.packageModel.name) || ''
    return {
      serialNum: '第' + (index + 1) + '号分包',
      packageTemplateId: pkgId,
      packageTemplateName: pkgName,
      compositions: comps,
      applianceNum: counts.applianceNum,
      implantsNum: counts.implantsNum,
      electricToolNum: counts.electricToolNum,
      open: index === 0
    }
  }

  // 订单主信息 → h5 表单/包信息字段
  function normalizeOrderMain (o) {
    return {
      id: o.id,
      serialNumber: o.serialNumber,
      orderTime: formatTime(o.orderTime),
      recycleTime: o.recycleTime ? formatTime(o.recycleTime) : null,
      bookHospitalId: o.hospitalModel ? o.hospitalModel.id : null,
      bookDepartmentId: o.departmentModel ? o.departmentModel.id : null,
      packageTemplateId: o.packageTemplateModel ? o.packageTemplateModel.id : null,
      packageTemplateName: o.packageTemplateModel ? o.packageTemplateModel.name : '',
      hospitalizationNum: o.hospitalizationNum || '',
      patientName: o.patientName || '',
      doctorName: o.doctorName || '',
      operationName: o.operationName || '',
      operationPart: o.operationPart || '',
      patientSection: o.patientSection || '',
      bedNum: o.bedNum || '',
      operationRoom: o.operationRoom || '',
      operationStage: o.operationStage || '',
      memo: o.memo || '',
      orderStatus: o.orderStatus != null ? o.orderStatus : 0
    }
  }

  // 后端订单 Map → h5 内部订单结构（字段对齐 app.js 卡片/编辑使用）
  function normalizeOrder (o) {
    return {
      id: o.orderId,
      serialNumber: o.serialNumber,
      orderTime: formatTime(o.orderTime),
      recycleTime: o.recycleTime ? formatTime(o.recycleTime) : null,
      bookHospitalName: o.hospitalName || '',
      bookDepartmentName: o.departmentName || '',
      packageTemplateName: o.packageTemplateName || '',
      hospitalizationNum: o.hospitalizationNum || '',
      patientName: o.patientName || '',
      doctorName: o.doctorName || '',
      operationName: o.operationName, operationPart: o.operationPart,
      patientSection: o.patientSection, bedNum: o.bedNum,
      operationRoom: o.operationRoom, operationStage: o.operationStage,
      memo: o.memo || '',
      orderStatus: o.orderStatus != null ? o.orderStatus : 0,
      // 列表接口未返回的编辑回填字段（编辑时经 getOutInstrumentOrder 补齐）
      bookHospitalId: null, bookDepartmentId: null, packageTemplateId: null
    }
  }

  /**
   * 订单列表（对齐 /out/getOutOrderList）
   * params：h5 筛选条件 { timeRange, hospitalId, hospitalizationNum, doctorName, serialNumber }；
   * page/pageSize：分页参数；返回 { list, total }（list 已 normalize）。
   */
  function getOrderList (params, page, pageSize) {
    var session = getSession()
    var range = toRange(params)
    var query = {
      startTime: range.startTime || undefined,
      endTime: range.endTime || undefined,
      supplierId: session && session.supplierId != null ? session.supplierId : undefined, // 必须传当前登录供应商 id
      hospitalId: (params && params.hospitalId) || undefined,
      hospitalizationNum: (params && params.hospitalizationNum) || undefined,
      doctorName: (params && params.doctorName) || undefined,
      orderNumber: (params && params.serialNumber) || undefined,
      orderStatus: undefined, // 不传：返回待回收+已回收全部状态
      page: page || 1,
      pageSize: pageSize || 20
    }
    return request('GET', CONFIG.urls.orderList + '?' + qs(query)).then(function (res) {
      return {
        list: ((res && res.list) || []).map(normalizeOrder),
        total: (res && res.total) || 0
      }
    })
  }

  /** 订单主信息（编辑回填，对齐 /out/getOutInstrumentOrder） */
  function getOutInstrumentOrder (id) {
    return request('GET', CONFIG.urls.getOutInstrumentOrder + '?id=' + encodeURIComponent(id)).then(function (res) {
      return res ? normalizeOrderMain(res) : null
    })
  }

  /** 订单分包明细（编辑回填，对齐 /out/getOutOrderDetailList） */
  function getOutOrderDetailList (orderId) {
    return request('GET', CONFIG.urls.getOutOrderDetailList + '?orderId=' + encodeURIComponent(orderId)).then(function (res) {
      var list = Array.isArray(res) ? res : ((res && res.list) || [])
      return list.map(normalizeOrderDetail)
    })
  }

  /**
   * 保存/更新订单（POST /out/saveOrUpdateOutOrder，body 对齐网页版 { outInstrumentOrder, outPackages }）。
   * 后端保存成功后不返回内容，调用方需刷新列表获取后端生成的订单号。
   */
  function saveOrder (order) {
    var outInstrumentOrder = {
      id: order.id || null,
      packageTemplateId: order.packageTemplateId,
      bookHospitalId: order.bookHospitalId,
      useDepartmentId: order.bookDepartmentId, // 后端科室字段名为 useDepartmentId
      supplierId: order.supplierId,
      hospitalizationNum: order.hospitalizationNum,
      patientName: order.patientName,
      doctorName: order.doctorName,
      operationName: order.operationName,
      operationPart: order.operationPart,
      patientSection: order.patientSection,
      bedNum: order.bedNum,
      operationRoom: order.operationRoom,
      operationStage: order.operationStage,
      memo: order.memo
    }
    var outPackages = (order.outPackages || []).map(function (p) {
      return {
        packageTemplateId: p.packageTemplateId,
        compositions: (p.compositions || []).map(function (c) {
          return {
            num: parseNum(c.num, 0),
            compositionId: c.compositionId,
            applianceName: c.applianceName,
            implants: c.type === '植入物',
            isElectricTool: c.type === '电动工具',
            type: c.type,
            specifical: c.specifical,
            model: c.model
          }
        })
      }
    })
    return request('POST', CONFIG.urls.saveOrder, {
      outInstrumentOrder: outInstrumentOrder,
      outPackages: outPackages
    })
  }

  return {
    CONFIG: CONFIG,
    request: request,
    getSession: getSession, setSession: setSession, clearSession: clearSession,
    login: login, logout: logout, getUserByToken: getUserByToken,
    getFunctionsByToken: getFunctionsByToken, assertOutOrderPermission: assertOutOrderPermission,
    getHospitals: getHospitals, getDepartments: getDepartments,
    getPackages: getPackages, getPackageCompositions: getPackageCompositions, getAllInstruments: getAllInstruments,
    getOrderList: getOrderList, saveOrder: saveOrder,
    getOutInstrumentOrder: getOutInstrumentOrder, getOutOrderDetailList: getOutOrderDetailList
  }
})()
