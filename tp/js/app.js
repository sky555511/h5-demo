/**
 * app.js — 消毒供应运营管理系统 H5 demo 主逻辑（Vue 2.7 本地版，无构建）
 * 数据层：统一走 js/api.js 接口封装（mock 本地数据 / 真实后端接口，见 API.CONFIG）。
 */
(function () {
  'use strict'

  var API = window.API

  // 会话（登录态）由 api.js 统一管理（token + 用户/供应商信息）
  var sessionUser = API.getSession()

  /* ---------- 工具函数 ---------- */
  function clone (x) { return JSON.parse(JSON.stringify(x)) }

  function parseNum (v, fallback) {
    if (fallback === undefined) fallback = 0
    if (v === undefined || v === null || v === '') return fallback
    var n = parseInt(v, 10)
    return isNaN(n) ? fallback : n
  }

  // GB2312 拼音首字母分界（I/U/V 不出现）。用于包名首字母检索，不依赖后端 pinyin 字段。
  var PY_LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ'
  var PY_BOUNDARIES = '阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀'

  function hanFirstLetter (ch) {
    try {
      if (ch.localeCompare(PY_BOUNDARIES.charAt(0), 'zh-CN') < 0) return ''
      for (var i = PY_BOUNDARIES.length - 1; i >= 0; i--) {
        if (ch.localeCompare(PY_BOUNDARIES.charAt(i), 'zh-CN') >= 0) {
          return PY_LETTERS.charAt(i).toLowerCase()
        }
      }
    } catch (e) { /* 部分 WebView 不支持 zh-CN collation */ }
    return ''
  }

  // 去掉空格与常见分隔符，便于「髋 关节」「k gj」也能命中
  function compactText (str) {
    return String(str || '').toLowerCase().replace(/[\s\-_/·•.,，。、()（）\[\]【】]+/g, '')
  }

  function getPinyinInitials (str) {
    var s = String(str || '')
    var out = ''
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i)
      var code = ch.charCodeAt(0)
      if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) { out += ch; continue }
      if (code >= 65 && code <= 90) { out += ch.toLowerCase(); continue }
      if (code >= 0x4e00 && code <= 0x9fff) out += hanFirstLetter(ch)
    }
    return out
  }

  function matchPackageKeyword (p, rawKw) {
    var kw = compactText(rawKw)
    if (!kw) return true
    var name = String(p.name || '')
    if (compactText(name).indexOf(kw) > -1) return true
    var code = compactText(p.code)
    if (code && code.indexOf(kw) > -1) return true
    var py = compactText(p.pinyin)
    if (py && py.indexOf(kw) > -1) return true
    var initials = getPinyinInitials(name)
    if (initials && initials.indexOf(kw) > -1) return true
    return false
  }

  // 分类数量统计（电动工具 > 植入物 > 器械；辅助材料不计入器械统计）
  function calcCounts (list) {
    var total = { applianceNum: 0, implantsNum: 0, electricToolNum: 0 }
    ;(list || []).forEach(function (c) {
      var n = parseInt(c.num, 10) || 0
      if (c.type === '电动工具') total.electricToolNum += n
      else if (c.type === '植入物') total.implantsNum += n
      else if (c.type === '辅助材料') { /* 辅助材料不计入器械/植入物/电动工具 */ }
      else total.applianceNum += n
    })
    return total
  }

  // 展示格式互转（存储统一 "YYYY-MM-DD HH:mm"）
  function fromLocalInput (v) { return v ? String(v).replace('T', ' ') : '' }

  // 订单二维码内容：统一走 api.js 的 CONFIG.qrText（demo 用订单号；接后端后可改为扫码回跳地址）
  function qrText (order) {
    return API.CONFIG.qrText(order)
  }

  function renderQrcode (el, order) {
    if (!el || !order) return
    el.innerHTML = ''
    try {
      /* global QRCode */
      new QRCode(el, {
        text: qrText(order),
        width: 200,
        height: 200,
        correctLevel: QRCode.CorrectLevel.M
      })
    } catch (e) {
      el.innerHTML = '<div style="color:#999;font-size:12px;text-align:center;padding-top:80px">二维码生成失败</div>'
    }
  }

  function wrapCanvasText (ctx, text, maxWidth) {
    var s = String(text || '')
    var lines = []
    var line = ''
    for (var i = 0; i < s.length; i++) {
      var next = line + s.charAt(i)
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line)
        line = s.charAt(i)
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
    return lines.length ? lines : ['']
  }

  // 保存用合成图：二维码 + 外来器械名称 + 住院号
  function composeQrcodeImage (qrCanvas, order) {
    var serial = (order && order.serialNumber) || ''
    var pkgName = (order && order.packageTemplateName) || '-'
    var zy = (order && order.hospitalizationNum) || '-'
    var pad = 36
    var qrSize = 400
    var width = 520
    var probe = document.createElement('canvas').getContext('2d')
    probe.font = '26px sans-serif'
    var maxText = width - pad * 2
    var pkgLines = wrapCanvasText(probe, '外来器械  ' + pkgName, maxText)
    var zyLines = wrapCanvasText(probe, '住院号  ' + zy, maxText)
    var titleH = 44
    var lineH = 36
    var gap = 18
    var height = pad + titleH + gap + qrSize + gap + pkgLines.length * lineH + 10 + zyLines.length * lineH + pad

    var out = document.createElement('canvas')
    out.width = width
    out.height = height
    var ctx = out.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = '#1b4fd8'
    ctx.font = 'bold 28px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(serial || '订单二维码', width / 2, pad)

    var qrX = Math.round((width - qrSize) / 2)
    var qrY = pad + titleH + gap
    ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize)

    ctx.textAlign = 'left'
    ctx.fillStyle = '#1f2430'
    ctx.font = '26px sans-serif'
    var y = qrY + qrSize + gap
    pkgLines.forEach(function (line) {
      ctx.fillText(line, pad, y)
      y += lineH
    })
    y += 8
    ctx.fillStyle = '#5b6472'
    zyLines.forEach(function (line) {
      ctx.fillText(line, pad, y)
      y += lineH
    })
    return out
  }

  /* ---------- 根实例 ---------- */
  new Vue({
    el: '#app',
    data: function () {
      return {
        view: sessionUser ? 'orderList' : 'login',   // login | orderList | create | pick | success
        editFlag: false,        // 是否为二次修改
        editingId: null,
        currentUser: sessionUser,
        loginForm: { account: '', password: '' },
        pwdVisible: false,
        logging: false,
        submitting: false,      // 提交订单防重复（弱网双击会产生重复订单）
        loadSeq: 0,             // 订单加载请求序号（筛选/重置后旧响应作废）

        hospitals: [],          // 医院列表（api.getHospitals 异步加载；mock 为嵌套含 departments，真实为扁平）
        departments: [],         // 当前所选医院的科室（真实模式按需加载）
        packages: [],            // 器械包模板列表（api.getPackages 异步加载）
        allInstruments: [],      // 全部器械库（api.getAllInstruments 异步加载）
        timeRanges: [
          { label: '今天', value: 'today' },
          { label: '近7天', value: '7d' },
          { label: '近30天', value: '30d' },
          { label: '全部', value: 'all' }
        ],
        // filterDraft：表单中正在编辑的查询条件；filter：已生效条件（点「查询」后同步）
        filterDraft: { timeRange: 'today', hospitalId: '', hospitalizationNum: '', doctorName: '', serialNumber: '' },
        filter: { timeRange: 'today', hospitalId: '', hospitalizationNum: '', doctorName: '', serialNumber: '' },
        allOrders: [], // 订单列表（分页累积，api.getOrderList 异步加载）
        // 分页加载状态（真实模式上拉加载）
        orderPage: 1,
        orderPageSize: 20,
        orderTotal: 0,
        loadingMore: false,
        noMore: false,
        loadingEdit: false,      // 真实模式编辑加载详情中

        steps: [
          { key: 'surgery', label: '手术信息' },
          { key: 'package', label: '包信息' },
          { key: 'preview', label: '订单预览' }
        ],
        step: 0,

        // 手术信息表单（字段对齐网页版 outInstrumentOrder）
        form: {
          emergencyType: '', // 手术类型：0=择期 1=急诊 2=备用
          bookHospitalId: '', bookDepartmentId: '', hospitalizationNum: '',
          patientName: '', doctorName: '', operationName: '', operationPart: '',
          patientSection: '', bedNum: '', operationTime: '', operationRoom: '', operationStage: '', memo: ''
        },

        // 包信息
        pkgKeyword: '',
        currentPackage: null,     // 当前选中包模板（含 compositions）
        draftCompositions: [],    // 当前编辑区器械（未分包草稿）
        subpackages: [],          // 已生成分包 [{serialNum, packageTemplateId, packageTemplateName, compositions, open}]

        // 选择器械页
        pickList: [],
        pickSelected: {},         // { compositionId: {…c, num} }，元素与 pickList 同引用（Vue2 需 $set/$delete 保证响应式）
        pickSourceTitle: '',
        pickType: '',             // 类型筛选（''=全部）
        pickKeyword: '',          // 关键词搜索（名称 / 型号）
        pickMode: '',             // 选择器械模式：'' / 'draft'=编辑草稿，'subpackage'=编辑已有分包
        pickSubIndex: -1,         // 编辑中的分包下标

        // 批量分包
        batchVisible: false,
        batchCount: '',

        // 通用确认弹层（自定义按钮顺序，替代 window.confirm）
        confirmVisible: false,
        confirmMsg: '',
        confirmCallback: null,

        // 二维码
        qrcodeVisible: false,
        qrcodeOrder: null,
        lastOrder: {},

        // toast
        toastVisible: false,
        toastMsg: '',
        toastTimer: null
      }
    },

    computed: {
      headerTitle: function () {
        if (this.view === 'login') return '供应商登录'
        if (this.view === 'create') return this.editFlag ? '修改订单' : '创建订单'
        if (this.view === 'pick') return '选择器械'
        if (this.view === 'success') return this.editFlag ? '修改成功' : '下单成功'
        return '消毒供应运营管理系统'
      },
      headerBack: function () {
        return this.view !== 'orderList' && this.view !== 'login'
      },
      emergencyTypeLabel: function () {
        return { '0': '择期', '1': '急诊', '2': '备用' }[this.form.emergencyType] || '-'
      },
      // 当前登录供应商（订单按此隔离；未登录或医院用户时供应商字段为空）
      supplier: function () {
        var u = this.currentUser
        if (!u) return { id: null, name: '', code: '' }
        return {
          id: u.supplierId != null ? u.supplierId : null,
          name: u.supplierName || u.unitName || u.name || ''
        }
      },

      currentDepartments: function () {
        // 科室按医院独立接口加载（this.departments）
        return this.departments
      },
      previewHospitalName: function () {
        var h = this.hospitals.find(function (x) { return x.id === Number(this.form.bookHospitalId) }.bind(this))
        return h ? h.name : '-'
      },
      previewDepartmentName: function () {
        var d = this.currentDepartments.find(function (x) { return x.id === Number(this.form.bookDepartmentId) }.bind(this))
        return d ? d.name : '-'
      },

      // 包名 / 拼音首字母检索（本地生成首字母；仅空格时列出全部包）
      matchedPackages: function () {
        var raw = this.pkgKeyword || ''
        if (!raw) return []
        if (!compactText(raw)) return this.packages.slice()
        return this.packages.filter(function (p) {
          return matchPackageKeyword(p, raw)
        })
      },
      isPkgLocked: function () {
        return this.subpackages.length > 0 || this.draftCompositions.length > 0
      },
      draftTotalNum: function () {
        return this.draftCompositions.reduce(function (s, c) { return s + c.num }, 0)
      },
      // 草稿器械分类统计（器械/植入物/电动工具，对齐院内版）
      draftSummary: function () {
        return calcCounts(this.draftCompositions)
      },
      // 已分包合计分类统计（全部分包加总）
      subpackagesSummary: function () {
        var s = { applianceNum: 0, implantsNum: 0, electricToolNum: 0 }
        this.subpackages.forEach(function (sp) {
          s.applianceNum += sp.applianceNum || 0
          s.implantsNum += sp.implantsNum || 0
          s.electricToolNum += sp.electricToolNum || 0
        })
        return s
      },
      // 已分包列表倒序展示（最新分包在上），不改动底层数组与序号
      subpackagesReversed: function () {
        return this.subpackages.slice().reverse()
      },
      // 预览包信息合计（全部分包 + 未分包草稿加总）
      previewSummary: function () {
        var s = { applianceNum: 0, implantsNum: 0, electricToolNum: 0 }
        this.previewPackages.forEach(function (sp) {
          s.applianceNum += sp.applianceNum || 0
          s.implantsNum += sp.implantsNum || 0
          s.electricToolNum += sp.electricToolNum || 0
        })
        return s
      },

      // 预览 = 已分包 + 未分包草稿（自动视为最后一个分包）
      previewPackages: function () {
        var list = clone(this.subpackages)
        if (this.draftCompositions.length && this.currentPackage) {
          var counts = calcCounts(this.draftCompositions)
          list.push({
            serialNum: '未分包草稿',
            packageTemplateName: this.currentPackage.name,
            compositions: clone(this.draftCompositions),
            applianceNum: counts.applianceNum,
            implantsNum: counts.implantsNum,
            electricToolNum: counts.electricToolNum
          })
        }
        return list
      },

      // 订单列表：后端已按筛选条件分页返回，直接展示
      filteredOrders: function () {
        return this.allOrders
      },

      // 选择器械页
      pickTypeTabs: function () {
        return [
          { key: '', label: '全部' },
          { key: '器械', label: '器械' },
          { key: '植入物', label: '植入物' },
          { key: '电动工具', label: '电动工具' }
        ]
      },
      pickFilteredList: function () {
        var self = this
        var kw = (this.pickKeyword || '').trim().toLowerCase()
        var list = this.pickList.filter(function (c) {
          if (self.pickType && c.type !== self.pickType) return false
          if (kw) {
            var name = String(c.applianceName || '').toLowerCase()
            var model = String(c.model || '').toLowerCase()
            var spec = String(c.specifical || '').toLowerCase()
            if (name.indexOf(kw) === -1 && model.indexOf(kw) === -1 && spec.indexOf(kw) === -1) return false
          }
          return true
        })
        // 已勾选的器械置顶展示（组内保持原顺序），方便查看与调整
        list.sort(function (a, b) {
          return (self.isPicked(a) ? 0 : 1) - (self.isPicked(b) ? 0 : 1)
        })
        return list
      },
      pickedCount: function () {
        return Object.keys(this.pickSelected).length
      },
      pickedTotalNum: function () {
        var s = 0
        for (var k in this.pickSelected) s += this.pickSelected[k].num
        return s
      }
    },

    methods: {
      /* ================= 登录 / 退出 ================= */
      // 账号输入框回车 → 聚焦密码框（iOS 键盘"换行"键跳转）
      focusLoginPwd: function () {
        var el = this.$refs.loginPwdInput
        if (el) el.focus()
      },
      // 初始化数据：医院科室 / 器械包 / 器械库 / 订单（已登录时 created 调用，登录成功后调用）
      initData: function () {
        var self = this
        var jobs = [
          API.getHospitals().then(function (list) { self.hospitals = list || [] }),
          API.getPackages().then(function (list) { self.packages = list || [] }),
          API.getAllInstruments().then(function (list) { self.allInstruments = list || [] })
        ]
        return Promise.all(jobs).catch(function (e) {
          self.showToast((e && e.message) || '数据加载失败')
        }).then(function () {
          return self.loadOrders(true)
        })
      },
      doLogin: function () {
        var account = (this.loginForm.account || '').trim()
        var password = this.loginForm.password || ''
        if (!account || !password) { this.showToast('请输入账号和密码'); return }
        var self = this
        this.logging = true
        API.login(account, password).then(function () {
          self.currentUser = API.getSession()
          return self.initData()
        }).then(function () {
          self.resetFilter()
          self.view = 'orderList'
          self.logging = false
          self.showToast('登录成功，欢迎 ' + self.currentUser.supplierName)
        }).catch(function (e) {
          self.logging = false
          self.showToast((e && e.message) || '登录失败')
        })
      },
      logout: function () {
        var self = this
        this.confirmDialog('确认退出登录？', function () {
          API.logout().then(function () {
            self.currentUser = null
            self.view = 'login'
            self.loginForm = { account: '', password: '' }
          })
        })
      },

      /* ================= 通用确认弹层 ================= */
      // 弹出确认框：msg 提示文案，onOk 确定回调（按钮顺序：取消左 / 确定右）
      confirmDialog: function (msg, onOk) {
        this.confirmMsg = msg
        this.confirmCallback = typeof onOk === 'function' ? onOk : null
        this.confirmVisible = true
      },
      closeConfirm: function () {
        this.confirmVisible = false
        this.confirmCallback = null
      },
      doConfirm: function () {
        var cb = this.confirmCallback
        this.confirmVisible = false
        this.confirmCallback = null
        if (cb) cb()
      },

      /* ================= 导航 ================= */
      typeClass: function (t) {
        return { '植入物': 'implant', '电动工具': 'power', '辅助材料': 'assist' }[t] || 'tool'
      },
      // 器械行类型 class（行级配色：左侧色条 + 底色微染）
      rowClass: function (t) {
        return 'row-' + this.typeClass(t)
      },
      goOrderList: function () {
        this.view = 'orderList'
        this.editFlag = false
        this.editingId = null
        this.closeQrcode()
        this.batchVisible = false
        // 列表容器为 v-show（不销毁），切回时重置滚动位置到顶部
        var self = this
        this.$nextTick(function () {
          var el = self.$refs.orderListMain
          if (el) el.scrollTop = 0
        })
      },
      goCreate: function () {
        this.resetOrderForm()
        this.batchVisible = false
        this.view = 'create'
      },
      onHeaderBack: function () {
        if (this.view === 'pick') { this.view = 'create'; return }
        this.goOrderList()
      },

      /* ================= 订单管理 ================= */
      applyFilter: function () {
        this.filter = Object.assign({}, this.filterDraft)
        // 筛选条件提交给后端重新查询（拉第一页）
        this.loadOrders(true)
      },
      // 加载订单：reset=true 拉第一页替换；false 追加下一页（上拉加载）
      loadOrders: function (reset) {
        var self = this
        var seq = ++this.loadSeq   // 请求序号：被更新的请求（筛选/重置）取代后，旧响应直接作废
        if (reset) { this.orderPage = 1; this.noMore = false }
        // 上拉加载进行中忽略追加（滚动事件会重复触发）；重置/筛选请求必须发出，不能吞掉
        if (this.loadingMore && !reset) return
        this.loadingMore = true
        API.getOrderList(this.filter, this.orderPage, this.orderPageSize).then(function (res) {
          if (seq !== self.loadSeq) return // 已被更新的请求取代，本响应作废
          var list = (res && res.list) || []
          var total = (res && res.total) || 0
          self.allOrders = reset ? list : self.allOrders.concat(list)
          self.orderTotal = total
          self.noMore = !list.length || self.allOrders.length >= total
          if (!self.noMore) self.orderPage++
          self.loadingMore = false
        }).catch(function (e) {
          if (seq !== self.loadSeq) return
          self.loadingMore = false
          self.showToast((e && e.message) || '加载失败')
        })
      },
      // 加载更多（分页，上拉加载）
      loadMore: function () {
        if (this.noMore || this.loadingMore) return
        this.loadOrders(false)
      },
      // 列表滚动到底部时自动加载下一页
      onOrderListScroll: function (e) {
        var el = e && e.target
        if (!el) return
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
          this.loadMore()
        }
      },
      resetFilter: function () {
        var def = { timeRange: 'today', hospitalId: '', hospitalizationNum: '', doctorName: '', serialNumber: '' }
        this.filterDraft = Object.assign({}, def)
        this.filter = Object.assign({}, def)
      },
      isRecycled: function (o) {
        return !!(o && o.recycleTime)
      },
      statusText: function (o) {
        // 仅两种状态：下单后待回收 / 供应室已回收
        return this.isRecycled(o) ? '已回收' : '待回收'
      },
      statusClass: function (o) {
        return this.isRecycled(o) ? 'recycled' : ''
      },
      showQrcode: function (o) {
        this.qrcodeOrder = o
        this.qrcodeVisible = true
        this.$nextTick(function () {
          renderQrcode(this.$refs.dialogQrcode, o)
        })
      },
      closeQrcode: function () {
        this.qrcodeVisible = false
        this.qrcodeOrder = null
      },
      downloadQrcode: function (container) {
        if (!container) return
        var canvas = container.querySelector('canvas')
        if (!canvas) { this.showToast('二维码暂不可用，请直接截图保存'); return }
        var order = this.qrcodeOrder || this.lastOrder || {}
        try {
          var composed = composeQrcodeImage(canvas, order)
          var a = document.createElement('a')
          a.href = composed.toDataURL('image/png')
          a.download = (order.serialNumber || 'qrcode') + '.png'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        } catch (e) {
          this.showToast('保存失败，请长按二维码截图')
        }
      },
      deleteOrder: function (o) {
        if (!o || !o.id || this.isRecycled(o)) return
        var self = this
        var no = o.serialNumber || ''
        this.confirmDialog('确认删除订单' + (no ? ' ' + no : '') + '？删除后不可恢复。', function () {
          API.deleteOutInstrumentOrder(o.id).then(function () {
            self.showToast('订单已删除')
            self.loadOrders(true)
          }).catch(function (e) {
            self.showToast((e && e.message) || '删除失败，请稍后重试')
          })
        })
      },

      /* ================= 二次修改：载入订单 ================= */
      startEdit: function (o) {
        if (this.isRecycled(o)) { this.showToast('已回收订单不可编辑'); return }
        this.editFlag = true
        this.editingId = o.id
        this.step = 0
        this.view = 'create'

        // 参照网页版，走订单主信息 + 分包明细接口异步回填
        var self = this
        this.loadingEdit = true
        API.getOutInstrumentOrder(o.id).then(function (main) {
          if (!main) throw { message: '订单不存在或已删除' }
          self.form = {
            emergencyType: main.emergencyType == null ? '' : String(main.emergencyType),
            bookHospitalId: main.bookHospitalId, bookDepartmentId: main.bookDepartmentId,
            hospitalizationNum: main.hospitalizationNum, patientName: main.patientName,
            doctorName: main.doctorName, operationName: main.operationName, operationPart: main.operationPart,
            patientSection: main.patientSection, bedNum: main.bedNum,
            operationTime: '', // 后端主信息未返回手术时间字段
            operationRoom: main.operationRoom, operationStage: main.operationStage, memo: main.memo
          }
          var pkg = self.packages.find(function (p) { return p.id === main.packageTemplateId })
          self.currentPackage = pkg ? clone(pkg) : { id: main.packageTemplateId, name: main.packageTemplateName || '', compositions: [] }
          self.pkgKeyword = main.packageTemplateName || ''
          // 按订单医院加载科室选项
          if (main.bookHospitalId) {
            API.getDepartments(main.bookHospitalId).then(function (list) {
              self.departments = list || []
            }).catch(function () {})
          }
          return Promise.all([
            API.getOutOrderDetailList(o.id),
            main.packageTemplateId
              ? API.getPackageCompositions(main.packageTemplateId).catch(function () { return [] })
              : Promise.resolve([])
          ])
        }).then(function (results) {
          var subs = results[0] || []
          var pkgComps = results[1] || []
          if (self.currentPackage) self.currentPackage.compositions = pkgComps
          // 详情接口不带回规格/型号/电动工具，用器械库 + 包组成补齐
          self.subpackages = subs.map(function (sp) {
            sp.compositions = (sp.compositions || []).map(function (c) {
              return self.enrichCompositionFromCatalog(c)
            })
            var counts = calcCounts(sp.compositions)
            sp.applianceNum = counts.applianceNum
            sp.implantsNum = counts.implantsNum
            sp.electricToolNum = counts.electricToolNum
            return sp
          })
          self.draftCompositions = []
          self.loadingEdit = false
        }).catch(function (e) {
          self.loadingEdit = false
          self.showToast((e && e.message) || '订单信息加载失败')
          self.goOrderList()
        })
      },

      /* ================= 创建订单：手术信息步骤 ================= */
      resetOrderForm: function () {
        this.editFlag = false
        this.editingId = null
        this.step = 0
        this.form = {
          emergencyType: '',
          bookHospitalId: '', bookDepartmentId: '', hospitalizationNum: '',
          patientName: '', doctorName: '', operationName: '', operationPart: '',
          patientSection: '', bedNum: '', operationTime: '', operationRoom: '', operationStage: '', memo: ''
        }
        this.pkgKeyword = ''
        this.currentPackage = null
        this.draftCompositions = []
        this.subpackages = []
      },
      onHospitalChange: function () {
        this.form.bookDepartmentId = ''
        // 科室按所选医院异步加载
        var self = this
        this.departments = []
        if (this.form.bookHospitalId) {
          API.getDepartments(this.form.bookHospitalId).then(function (list) {
            self.departments = list || []
          }).catch(function (e) {
            self.showToast((e && e.message) || '科室加载失败')
          })
        }
      },

      /* ================= 创建订单：步骤跳转 ================= */
      stepNext: function () {
        if (this.step === 0) {
          if (this.form.emergencyType === '') { this.showToast('请选择手术类型'); return }
          if (!this.form.bookHospitalId) { this.showToast('请选择预约医院'); return }
          if (!this.form.bookDepartmentId) { this.showToast('请选择使用科室'); return }
          if (this.form.emergencyType !== '2' && !(this.form.hospitalizationNum || '').trim()) { this.showToast('请输入住院号'); return }
          this.step = 1
        } else if (this.step === 1) {
          if (!this.currentPackage) { this.showToast('请选择器械包'); return }
          if (!this.subpackages.length) {
            if (!this.draftCompositions.length) { this.showToast('请先选择器械并完成分包'); return }
            this.showToast('请先点击「分包」生成分包'); return
          }
          this.step = 2
        } else if (this.step === 2) {
          this.submitOrder()
        }
      },
      stepPrev: function () { if (this.step > 0) this.step-- },

      /* ================= 包信息：选包 / 器械 / 分包 ================= */
      selectPackage: function (p) {
        this.currentPackage = clone(p)
        this.pkgKeyword = p.name
        this.subpackages = []
        // 包列表接口不含组成，选包后按需加载包组成明细
        var self = this
        this.currentPackage.compositions = []
        this.draftCompositions = []
        // 立即把 pickList 准备好，并把当前包组成（包括植入物）补进去，保证外面与里面数据完全一致
        this.buildPickList()
        this.addCurrentPackageCompositionsToPickList()
        API.getPackageCompositions(p.id).then(function (comps) {
          if (self.currentPackage && self.currentPackage.id === p.id) {
            self.currentPackage.compositions = comps || []
            // 保留接口返回的数量（0 / 空值都按 0）
            self.draftCompositions = (comps || []).map(function (c) { return Object.assign(clone(c), { num: parseNum(c.num, 0) }) })
            // 后端返回的组成可能与初始补的不同，重新补一次，确保 pickList 与 currentPackage.compositions 完全一致
            self.addCurrentPackageCompositionsToPickList()
          }
        }).catch(function (e) {
          self.showToast((e && e.message) || '器械组成加载失败')
        })
      },
      clearPackage: function () {
        var self = this
        if (this.isPkgLocked) {
          this.confirmDialog('清空后将移除已选器械与分包，是否继续？', function () {
            self.clearPackageNow()
          })
          return
        }
        this.clearPackageNow()
      },
      clearPackageNow: function () {
        this.currentPackage = null
        this.pkgKeyword = ''
        this.draftCompositions = []
        this.subpackages = []
      },
      openPick: function () {
        if (!this.currentPackage) { this.showToast('请先选择器械包'); return }
        // 二次编辑进入时草稿为空、器械都在分包里：只有 1 个分包时直接改它，避免「选择器械」看不到已选、确认后变成另一份草稿
        if (this.editFlag && !this.draftCompositions.length && this.subpackages.length === 1) {
          this.editSubpackage(this.subpackages[0])
          return
        }
        this.pickSourceTitle = '全部器械'
        this.buildPickList()
        this.addCurrentPackageCompositionsToPickList()   // 把当前包组成（包括植入物）补到 pickList 顶部，保证外面与里面数据一致
        // 选择器械 = 编辑当前草稿：预勾选包内/已选器械（不再 unshift，避免覆盖顶部植入物）
        this.preselectPickItems(this.draftCompositions)
        this.pickType = ''
        this.pickKeyword = ''
        this.pickMode = 'draft'
        this.pickSubIndex = -1
        this.view = 'pick'
      },
      // 全量器械库：由 api.getAllInstruments 提供（各包组成 + 通用器械库，去重并按类型归组）
      // 只负责 clone allInstruments，不附加包组成；调用方按需调 addCurrentPackageCompositionsToPickList
      buildPickList: function () {
        this.pickList = clone(this.allInstruments)
      },
      sameInstrument: function (a, b) {
        if (!a || !b) return false
        if (a.compositionId != null && b.compositionId != null && String(a.compositionId) === String(b.compositionId)) return true
        if (a.instrumentId != null && b.instrumentId != null && String(a.instrumentId) === String(b.instrumentId)) return true
        // 仅在一侧缺对应 id 时才交叉比对，避免 compositionId 与别人的 instrumentId 碰巧相同
        if (a.compositionId != null && b.compositionId == null && b.instrumentId != null && String(a.compositionId) === String(b.instrumentId)) return true
        if (b.compositionId != null && a.compositionId == null && a.instrumentId != null && String(b.compositionId) === String(a.instrumentId)) return true
        if (a.instrumentId != null && b.instrumentId == null && b.compositionId != null && String(a.instrumentId) === String(b.compositionId)) return true
        if (b.instrumentId != null && a.instrumentId == null && a.compositionId != null && String(b.instrumentId) === String(a.compositionId)) return true
        return false
      },
      enrichCompositionFromCatalog: function (c) {
        var hit = this.findCatalogItem(c)
        if (!hit) return Object.assign({}, c)
        return Object.assign({}, c, {
          compositionId: hit.compositionId != null ? hit.compositionId : c.compositionId,
          instrumentId: hit.instrumentId != null ? hit.instrumentId : c.instrumentId,
          applianceName: c.applianceName || hit.applianceName,
          specifical: c.specifical || hit.specifical,
          model: c.model || hit.model,
          type: hit.type || c.type
        })
      },
      catalogPool: function () {
        var pkgComps = this.currentPackage && this.currentPackage.compositions
        return (this.allInstruments || []).concat(pkgComps || [])
      },
      findCatalogItem: function (c) {
        if (!c) return null
        var self = this
        var pool = this.catalogPool()
        var hit = pool.find(function (x) { return self.sameInstrument(x, c) })
        if (hit) return hit
        // 历史订单曾把器械库 id 存成 compositionId，按 instrumentId 再兜一次
        if (c.compositionId != null) {
          hit = pool.find(function (x) { return x.instrumentId != null && String(x.instrumentId) === String(c.compositionId) })
        }
        return hit || null
      },
      // 在选择列表中定位已有器械：compositionId 优先，兼容历史订单里把器械库 id 存成 compositionId
      findPickItem: function (c) {
        if (!c) return null
        var self = this
        var same = this.pickList.find(function (x) { return self.sameInstrument(x, c) })
        if (same) return same
        if (c.compositionId != null) {
          same = this.pickList.find(function (x) {
            return x.instrumentId != null && String(x.instrumentId) === String(c.compositionId)
          })
        }
        return same || null
      },
      // 把当前包的组成强制补到 pickList 里（置顶显示），保证外面（currentPackage.compositions）
      // 与里面（pickList）的数据完全一致
      // 关键实现：用 compositionId 去重，pickList 里已有同 id 的对象会被 splice 出来放到顶部
      // 注意：不要 clone pkgComp，要保留引用关系以便 Vue 响应式更新
      addCurrentPackageCompositionsToPickList: function () {
        var self = this
        if (!this.currentPackage) return
        var pkgComps = this.currentPackage.compositions || []
        var restList = []
        for (var i = 0; i < self.pickList.length; i++) {
          var item = self.pickList[i]
          var inPkg = pkgComps.some(function (c) { return self.sameInstrument(item, c) })
          if (!inPkg) restList.push(item)
        }
        // 重建 pickList：包组成在前（保留引用，确保响应式）+ 其余在后
        self.pickList = pkgComps.concat(restList)
      },
      // 预勾选已有器械（包内草稿 / 分包明细），数量沿用已选值
      // 重要：addCurrentPackageCompositionsToPickList 已经把当前包组成 unshift 到 pickList 顶部，
      // 这里的 draftCompositions 是 currentPackage.compositions 的子集，所以 findPickItem 一定能找到。
      // 这里**完全不再 unshift**，只更新 num 和写入 pickSelected（让 ✓ 标记生效）
      preselectPickItems: function (comps) {
        this.pickSelected = {}
        var self = this
        var extras = []
        ;(comps || []).forEach(function (c) {
          var same = self.findPickItem(c)
          if (!same) {
            // 器械库未覆盖到的已选器械（含植入物）补进列表，避免二次编辑时勾选丢失
            same = Object.assign({}, self.enrichCompositionFromCatalog(c), { num: parseNum(c.num, 0) })
            extras.push(same)
          } else {
            self.$set(same, 'num', parseNum(c.num, 0))
            if (!same.specifical && c.specifical) self.$set(same, 'specifical', c.specifical)
            if (!same.model && c.model) self.$set(same, 'model', c.model)
          }
          var key = self.pickKey(same)
          if (key) self.$set(self.pickSelected, key, same)
        })
        if (extras.length) this.pickList = extras.concat(this.pickList)
      },
      // 重新编辑分包：进入选择器械页并预勾选该分包器械，确认后更新该分包
      editSubpackage: function (sp) {
        var idx = this.subpackages.indexOf(sp)
        if (idx < 0) return
        this.pickSourceTitle = '编辑' + sp.serialNum
        this.buildPickList()
        this.addCurrentPackageCompositionsToPickList()   // 把当前包组成（包括植入物）补到 pickList 里，置顶显示
        this.preselectPickItems(sp.compositions)
        this.pickType = ''
        this.pickKeyword = ''
        this.pickMode = 'subpackage'
        this.pickSubIndex = idx
        this.view = 'pick'
      },
      pickKey: function (c) {
        if (!c) return ''
        if (c.compositionId != null) return 'c' + c.compositionId
        if (c.instrumentId != null) return 'i' + c.instrumentId
        return 'n' + (c.applianceName || '')
      },
      isPicked: function (c) {
        var key = this.pickKey(c)
        if (key != null && this.pickSelected[key]) return true
        var self = this
        return Object.keys(this.pickSelected).some(function (k) {
          return self.sameInstrument(self.pickSelected[k], c)
        })
      },
      togglePick: function (c) {
        var key = this.pickKey(c)
        if (this.isPicked(c)) {
          var self = this
          Object.keys(this.pickSelected).forEach(function (k) {
            if (self.sameInstrument(self.pickSelected[k], c)) self.$delete(self.pickSelected, k)
          })
        } else {
          if (typeof c.num !== 'number') { this.$set(c, 'num', 1) } // 组成模板默认无 num，勾选时补 1
          if (key) this.$set(this.pickSelected, key, c)
        }
      },
      confirmPick: function () {
        var self = this
        if (this.pickMode === 'subpackage') {
          // 编辑分包：替换器械并重算统计，保留分包序号与位置
          var sp = this.subpackages[this.pickSubIndex]
          if (sp) {
            var comps = Object.keys(this.pickSelected).map(function (k) { return clone(self.pickSelected[k]) })
            if (!comps.length) {
              this.removeSubpackage(sp) // 器械全部取消勾选：直接删除该分包，避免提交空分包
            } else {
              var counts = calcCounts(comps)
              sp.compositions = comps
              sp.applianceNum = counts.applianceNum
              sp.implantsNum = counts.implantsNum
              sp.electricToolNum = counts.electricToolNum
              this.showToast('已更新' + sp.serialNum)
            }
          }
          this.pickMode = ''
          this.pickSubIndex = -1
          this.view = 'create'
          return
        }
        // 选择器械 = 编辑草稿：用当前勾选结果覆盖草稿（取消勾选即从草稿移除，数量一并带回）
        this.draftCompositions = Object.keys(this.pickSelected).map(function (k) { return clone(self.pickSelected[k]) })
        this.pickMode = ''
        this.pickSubIndex = -1
        this.view = 'create'
      },
      incNum: function (c) { if (c) c.num = (c.num || 0) + 1 },
      decNum: function (c) { if (c && (c.num || 1) > 1) c.num-- },
      // 直接输入数量（正整数 1-999），非法输入回退为 1
      setNum: function (c, val) {
        var n = parseInt(val, 10)
        if (isNaN(n) || n < 1) { n = 1 }
        if (n > 999) { n = 999 }
        if (c && c.num !== n) this.$set(c, 'num', n)
      },
      removeFromDraft: function (c) {
        var self = this
        var i = this.draftCompositions.findIndex(function (x) { return self.sameInstrument(x, c) })
        if (i > -1) this.draftCompositions.splice(i, 1)
      },
      // 分包序号唯一递增（删除分包后仍不重复，用作 v-for key）
      nextSerialNum: function () {
        var max = 0
        this.subpackages.forEach(function (sp) {
          var m = /^第(\d+)号分包$/.exec(sp.serialNum)
          if (m) max = Math.max(max, parseInt(m[1], 10))
        })
        return '第' + (max + 1) + '号分包'
      },
      splitPackage: function () {
        if (!this.currentPackage) { this.showToast('请先选择器械包'); return }
        if (!this.draftCompositions.length) { this.showToast('请先选择器械'); return }
        var counts = calcCounts(this.draftCompositions)
        this.subpackages.push({
          serialNum: this.nextSerialNum(),
          packageTemplateId: this.currentPackage.id,
          packageTemplateName: this.currentPackage.name,
          compositions: clone(this.draftCompositions),
          applianceNum: counts.applianceNum,
          implantsNum: counts.implantsNum,
          electricToolNum: counts.electricToolNum,
          open: true
        })
        this.draftCompositions = []
      },
      openBatchSplit: function () {
        if (!this.currentPackage) { this.showToast('请先选择器械包'); return }
        if (!this.draftCompositions.length) { this.showToast('请先选择器械'); return }
        this.batchCount = ''
        this.batchVisible = true
      },
      closeBatchSplit: function () {
        this.batchVisible = false
      },
      confirmBatchSplit: function () {
        var val = String(this.batchCount || '').trim()
        if (!/^[1-9]\d{0,2}$/.test(val)) { this.showToast('请输入 1-999 的正整数'); return }
        if (!this.draftCompositions.length) { this.showToast('请先选择器械'); return }
        var n = parseInt(val, 10)
        var first = this.subpackages.length === 0
        var counts = calcCounts(this.draftCompositions)
        for (var i = 0; i < n; i++) {
          this.subpackages.push({
            serialNum: this.nextSerialNum(),
            packageTemplateId: this.currentPackage.id,
            packageTemplateName: this.currentPackage.name,
            compositions: clone(this.draftCompositions),
            applianceNum: counts.applianceNum,
            implantsNum: counts.implantsNum,
            electricToolNum: counts.electricToolNum,
            open: first && i === 0
          })
        }
        this.draftCompositions = []
        this.batchVisible = false
        this.showToast('已生成 ' + n + ' 个分包')
      },
      // 删除整个分包（删除按钮 / 分包内器械删空时调用）
      removeSubpackage: function (sp) {
        var i = this.subpackages.findIndex(function (x) { return x.serialNum === sp.serialNum })
        if (i > -1) {
          this.subpackages.splice(i, 1)
          this.showToast('已删除' + sp.serialNum)
          // 全部删除后：草稿保持为空，选包输入框自动解锁（isPkgLocked 依赖 subpackages/草稿），可重新选包再分包
        }
      },
      // 删除分包内的单个器械（并重算该分包分类统计）；删空后自动移除该分包
      removeCompositionFromSubpackage: function (sp, c) {
        var self = this
        var i = sp.compositions.findIndex(function (x) { return self.sameInstrument(x, c) })
        if (i === -1) return
        sp.compositions.splice(i, 1)
        if (sp.compositions.length === 0) {
          this.removeSubpackage(sp)
          this.showToast('分包器械已清空，该分包已删除')
          return
        }
        var counts = calcCounts(sp.compositions)
        sp.applianceNum = counts.applianceNum
        sp.implantsNum = counts.implantsNum
        sp.electricToolNum = counts.electricToolNum
      },

      /* ================= 提交订单 ================= */
      submitOrder: function () {
        var self = this
        if (this.submitting) return // 防重复提交（弱网下双击会产生重复订单）
        this.submitting = true
        var old = this.editFlag
          ? this.allOrders.find(function (o) { return o.id === self.editingId })
          : null
        var order = {
          id: old ? old.id : null, // 新建时由 api（mock/后端）生成 id/serialNumber/orderTime
          serialNumber: old ? old.serialNumber : '',
          orderTime: old ? old.orderTime : '',
          bookHospitalId: Number(this.form.bookHospitalId),
          bookHospitalName: this.previewHospitalName,
          bookDepartmentId: Number(this.form.bookDepartmentId),
          bookDepartmentName: this.previewDepartmentName,
          emergencyType: Number(this.form.emergencyType),
          hospitalizationNum: this.form.hospitalizationNum,
          patientName: this.form.patientName,
          doctorName: this.form.doctorName,
          operationName: this.form.operationName,
          operationPart: this.form.operationPart,
          patientSection: this.form.patientSection,
          bedNum: this.form.bedNum,
          operationTime: fromLocalInput(this.form.operationTime),
          operationRoom: this.form.operationRoom,
          operationStage: this.form.operationStage,
          memo: this.form.memo,
          supplierId: this.supplier.id,
          supplierName: this.supplier.name,
          packageTemplateId: this.currentPackage.id,
          packageTemplateName: this.currentPackage.name,
          outPackages: this.previewPackages.map(function (p) {
            return {
              packageTemplateId: this.currentPackage.id,
              packageTemplateName: this.currentPackage.name,
              compositions: p.compositions
            }
          }.bind(this)),
          orderStatus: old ? old.orderStatus : 0,
          recycleTime: old ? old.recycleTime : null
        }

        // 后端保存成功不返回内容，刷新列表第一页，以最新一条作为刚提交的订单（后端 orderTime 倒序）
        // 新建订单不能用当前筛选条件刷新：若筛了医院/订单号，新单不在结果里，成功页会取错订单号；
        // 统一回"今天"默认条件（新单下单时间为当下，必在其中）；编辑订单仍在原筛选结果中，按原条件刷新
        API.saveOrder(order).then(function () {
          var fresh = { timeRange: 'today', hospitalId: '', hospitalizationNum: '', doctorName: '', serialNumber: '' }
          var params = old ? self.filter : fresh
          if (!old) { self.filter = Object.assign({}, fresh); self.filterDraft = Object.assign({}, fresh) }
          return API.getOrderList(params, 1, self.orderPageSize).then(function (res) {
            var list = (res && res.list) || []
            self.allOrders = list
            self.orderTotal = (res && res.total) || 0
            self.noMore = !list.length || list.length >= self.orderTotal
            // 编辑：订单号已知用提交内容；新建：取列表最新一条（后端生成订单号）
            self.lastOrder = old ? Object.assign({}, order, { id: old.id, serialNumber: old.serialNumber, orderTime: old.orderTime }) : (list[0] || order)
            return self.lastOrder
          })
        }).then(function (last) {
          self.submitting = false
          self.view = 'success'
          self.$nextTick(function () {
            renderQrcode(self.$refs.successQrcode, last)
          })
          self.showToast(self.editFlag ? '订单已更新' : '下单成功')
        }).catch(function (e) {
          self.submitting = false
          self.showToast((e && e.message) || '保存失败，请稍后重试')
        })
      },

      /* ================= 轻量 toast ================= */
      showToast: function (msg) {
        var self = this
        this.toastMsg = msg
        this.toastVisible = true
        clearTimeout(this.toastTimer)
        this.toastTimer = setTimeout(function () { self.toastVisible = false }, 1800)
      }
    },

    /* ================= 生命周期 ================= */
    // token 失效（401/403）时跳回登录页
    created: function () {
      var self = this
      API.CONFIG.onAuthFail = function () {
        self.currentUser = null
        self.view = 'login'
        self.loginForm = { account: '', password: '' }
        self.showToast('登录已失效，请重新登录')
      }
      // 已登录（刷新 / 直接打开页面）：先校验页面权限，再加载订单与基础数据
      if (this.currentUser) {
        API.assertOutOrderPermission().then(function () {
          return self.initData()
        }).then(function () {
          self.resetFilter()
        }).catch(function (e) {
          self.currentUser = null
          self.view = 'login'
          self.showToast((e && e.message) || '暂无访问权限')
        })
      }
    },
    // 绑定订单列表滚动监听（上拉加载）
    mounted: function () {
      var self = this
      this.$nextTick(function () {
        var el = self.$refs.orderListMain
        if (el) el.addEventListener('scroll', self.onOrderListScroll)
      })
    },
    beforeDestroy: function () {
      var el = this.$refs.orderListMain
      if (el) el.removeEventListener('scroll', this.onOrderListScroll)
    }
  })
})()
