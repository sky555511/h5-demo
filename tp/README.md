# 消毒供应运营管理系统 · 供应商端 H5 Demo

供应商外网下单功能的**手机端 H5 原型**（纯静态，无构建、无第三方 UI 框架），已接入真实后端（etrace，接口对接见下文）。

## 功能范围

手机端包含登录页 + 两个主界面（底部 tab 切换）：

### 0. 登录（供应商外网入口）
- 账号密码登录（走 `/user/login`，账号由后端数据库管理），登录后按**供应商隔离**订单数据（对应网页版按登录用户供应商过滤）
- 登录成功后会调 `/user/getFunctionsByToken` 校验是否具备网页版「外来器械订单管理」菜单（`/process/outPackage/outOrderManage`）；无此页面权限会提示「暂无访问权限」并清登录态，不能进入 H5
- 联调账号需在后端角色中配置该菜单；医院用户/无该菜单账号即使账号密码正确也不能进入供应商端
- 登录态 localStorage 持久化，可退出登录；供应商卡片右上角「退出」

### 1. 订单管理
- 查询筛选：下单时间（今天 / 近7天 / 近30天 / 全部）、医院、住院号、订单号；条件在表单中选择，点「查询」后才生效，「重置」恢复默认（今天）
- 卡片式订单列表，状态仅两种：`待回收`（可编辑、可删除、可生成二维码）、`已回收`（仅二维码）
- 生成订单二维码（页面与保存的 PNG 均展示外来器械名称、患者住院号）
- **待回收订单可二次修改**，修改流程与创建一致，保存后订单号不变
- **未被供应室回收的订单允许供应商自行删除**（`POST /out/deleteOutInstrumentOrder`，body `{ id }`）

### 2. 创建订单（3 步流程）
| 步骤 | 内容 |
| --- | --- |
| ① 手术信息 | 仅 **4 项**：预约医院（必填）、使用科室（必填，联动医院）、住院号（必填，仅作记录，不提供 HIS 查询带出）、备注（选填） |
| ② 包信息 | 按**包名称 / 拼音首字母**检索外来器械包；选包后若已维护器械组成则自动带出；「选择器械」进入器械页，展示**全部器械**（各包组成 + 通用器械库，按类型归组，支持**类型筛选（器械 / 植入物 / 电动工具）**与**关键词搜索**；**包内已有器械预勾选并置顶**，确认后覆盖当前草稿，可跨包增删，数量支持 +/- 或**直接输入**，展示规格/型号）；「分包」将当前器械生成分包，「批量分包」输入数量 N 后把当前器械拆分为 N 个相同分包；分包列表展示在页面底部，可展开 / 删除，每个分包卡支持**重新编辑**（进入选择器械页预勾选原器械并置顶，可增删改后原地更新）与**删除整个分包**，顶部有**全部分包合计**统计；支持多分包；**分类数量统计（器械 / 植入物 / 电动工具）**与院内版一致（按件数累计，电动工具 > 植入物 > 其余归器械），展示在草稿区、每个分包卡、分包合计条及订单预览中 |
| ③ 订单预览 | 二次核对手术信息与全部分包明细（包信息顶部有**分包数 + 器械/植入物/电动工具合计**总览条），可「上一步」返回调整，确认后「提交订单」生成订单二维码 |

提交成功页展示订单二维码，并展示外来器械名称、患者住院号；「保存二维码图片」会把这两项一并写入 PNG。

## 运行方式

```bash
# 方式一：直接打开（双击 index.html 即可，无需任何依赖）
h5-demo/index.html

# 方式二：本地服务器（推荐，桌面预览 + 手机真机预览）
cd h5-demo
npm install        # 仅首次（vendor 库已在 js/vendor/ 内置，可不装）
npm run serve      # 等价 node server.js，默认 8080 端口
# 桌面访问 http://localhost:8080
# 手机与电脑同一局域网，访问 http://<电脑IP>:8080（启动时会打印 IP）
```

> 说明：`js/vendor/` 下已内置 `vue.min.js`（Vue 2.7）与 `qrcode.min.js`，不安装任何依赖也能直接打开 index.html 使用。

## 目录结构

```
h5-demo/
├── index.html          # 页面模板（Vue in-DOM 模板）
├── css/app.css         # 全部样式（手写，医疗蓝绿主题）
├── js/
│   ├── vendor/         # 本地化的 vue / qrcodejs / crypto-js
│   ├── api.js          # 接口封装层：登录/订单/基础数据全部真实接口（后端 etrace）
│   └── app.js          # 主逻辑（Vue 实例，仅调用 API.*，不直接读写数据）
└── server.js           # 零依赖静态服务器（真机预览用）
```

> 界面说明：订单卡片仅展示医院 / 科室 / 患者 / 回收时间与**单独一行的器械包名称**（不含医师、手术名称）；「上一步 / 下一步」固定在页面底部。

## 后端对接

所有后端交互集中在 **`js/api.js` 接口封装层**（登录/退出、订单列表与保存、医院科室、器械包、器械库），`app.js` 只调用 `API.*`，不直接读写数据。

### 配置

后端地址在 `js/api.js` 顶部 `CONFIG` 修改：

```js
var CONFIG = {
  baseURL: 'http://127.0.0.1:8899', // 后端根地址（尾斜杠自动去除）
  urls: { ... }                     // 各接口路径（对齐后端 etrace）
}
```

`request()` 已封装：`u-token` 请求头（登录态）、15s 超时、401/403 自动清登录态、错误文本/JSON 兼容。

### 接口清单（对齐 etrace-html / 后端 etrace 项目）

| API 函数 | 方法/路径 | 说明 |
| --- | --- | --- |
| `API.login(account, password)` | POST `/user/login` | 账号密码按与后端约定的 AES-128-ECB 加密后放入 Basic Auth（密钥不在前端源码明文出现）；body `{ pcname, captcha }`；token 在响应 `message` 字段；登录后自动校验 `/user/getFunctionsByToken` |
| `API.logout()` | POST `/user/logout` | body `{ message: token }` |
| `API.getUserByToken()` | GET `/user/getUserByToken` | 经 `u-token` 头取当前用户，返回 UserModel；登录成功后自动调用并写入会话 |
| `API.getFunctionsByToken()` | GET `/user/getFunctionsByToken` | 当前用户菜单/功能权限（`pages` + `functions`）；登录与刷新时校验是否含 `/process/outPackage/outOrderManage` |
| `API.assertOutOrderPermission()` | — | 基于上一接口校验 H5 页面权限，无权限清会话并 reject「暂无访问权限」 |
| `API.getHospitals()` | GET `/hospital/list` | `nameOrCode=&page=1&pageSize=999`，返回扁平 `{id, name}` 列表 |
| `API.getDepartments(hospitalId)` | GET `/department/listByHospital` | 按医院加载使用科室（`isOperationRoom=true`）；选医院时自动加载 |
| `API.getPackages(nameOrCode)` | GET `/package/list` | `ifOut=true + 当前登录供应商 supplierId`，返回包模板列表（不含组成） |
| `API.getPackageCompositions(packageTemplateId)` | GET `/package/getPackageCompositions` | 包组成明细（`ifUseOrder=false&ifOutTypeOrder=true`），normalize 为 h5 器械结构（选包时自动加载） |
| `API.getAllInstruments()` | GET `/instrument/list` | `dataFlag=true&isRentInstrument=true&unitNameOrCode=<供应商名称>`，返回全部器械库 |
| `API.getOrderList(params, page, pageSize)` | GET `/out/getOutOrderList` | params 传 `{ timeRange, hospitalId, hospitalizationNum, doctorName, serialNumber }`（`supplierId` 必须传当前登录供应商 id；`orderStatus` 不传=全部状态）；返回 `{ list, total }`，时间戳 normalize 为 `YYYY-MM-DD HH:mm`；列表支持**上拉加载更多**（每页 20 条） |
| `API.getOutInstrumentOrder(id)` | GET `/out/getOutInstrumentOrder` | 订单主信息（编辑回填） |
| `API.getOutOrderDetailList(orderId)` | GET `/out/getOutOrderDetailList` | 订单分包明细（器械 `compositionModel` 嵌套 normalize，类型按 `hasImplant`/`electricTool`/`compositionProperty.code` 映射） |
| `API.saveOrder(order)` | POST `/out/saveOrUpdateOutOrder` | body 对齐网页版 `{ outInstrumentOrder, outPackages }`（科室字段为 `useDepartmentId`）；后端保存成功不返回内容，调用方刷新列表取最新订单；⚠️ 仅**供应商用户**可下单 |
| `API.deleteOutInstrumentOrder(orderId)` | POST `/out/deleteOutInstrumentOrder` | 删除未被供应室回收的订单，body `{ id }`（对齐网页版追溯系统，后端校验字段名为 id）；仅订单管理首页待回收订单可操作 |
| `API.CONFIG.qrText(order)` | — | 二维码内容，默认订单号，可改为扫码回跳地址 |

- **登录态**：会话（token + 用户/供应商信息）由 `API.getSession / setSession / clearSession` 管理，存于 `h5_out_user`；**后续请求经 `u-token` 请求头传递**
- **响应约定**：成功 = HTTP 2xx + 各接口自有结构；失败 = HTTP 4xx/5xx + 错误文本/JSON（无统一 `code` 包装）
- **订单字段**：订单结构对齐网页版 `outInstrumentOrder`（`orderStatus`：0 未确认可编辑 / 1 已确认；`recycleTime` 非空表示已回收）。已回收订单不展示编辑/删除按钮

## 已知取舍（demo 范畴）

- 二次修改在保存后订单仍为「待回收」状态（与网页版一致：已回收订单前端不可编辑）
- 「保存分包方案」「急件/加急费」等网页版能力未纳入 demo
