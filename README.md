﻿# AI弹幕组件

一行代码，为任意网站接入弹幕系统。支持 AI 自动弹幕、WebSocket 实时推送、点赞/关闭交互、后端审核过滤，以及插件化的推送/统计/广告/消息识别扩展，适用于个人博客、直播、评论系统、客服挂件等场景，无需后端开箱可用。

> 最新插件开发手册（在线）：[https://push.phprm.com/plugins.html](https://push.phprm.com/plugins.html)

## 使用场景

| 场景 | 怎么接 | 说明 |
| ---- | ---- | ---- |
| 离线 HTML | 单个 html 文件里放一行云端 `<script>`，组件、插件、样式全走线上地址 | 双击 `file://` 就能跑，无需部署；`localStorage` 不可用时自动回退 cookie。示例 `examples/offline.html` |
| WorkBuddy 应用 | 应用里打开的网页粘同一行脚本，`channelCode` 留空即按当前网址自动认领通道 | 应用侧没有你自己的后端也能用：发弹幕、看统计直接走官网或 GET 触发链接 |
| Qoder 站点 | 站点各页面写同一个 `channelCode`，整站汇到一条通道 | `plugins=stat` 做网页统计（`danMu=0` 时 visit/click 不会打屏），`plugins=ad` 出广告位，可 `plugins=stat,ad` 同时加载 |
| PDF 离线分发 | 用 [在线工具 · PDF 转 HTML](https://www.phprm.com/develop/pdf-html.html) 把手头的 PDF 资料转成离线 HTML，页面里放同一行脚本，打包上传网盘 | 有人下载打开就是一条 `visit` 统计，官网绑定了飞书 / 钉钉 / 企业微信 / 邮箱时手机实时收到访问提醒；文档是离线包、不依赖你的服务器，但只要他打开页面就会连上通道，你就能持续给他推 `plugins=ad` 广告图 + 链接（例如双十一活动页），点击跳转即收入变现 |
| 短信验证码自动识别 | 挂件里加载 `plugins=msg-sms-code` | 插件订阅完整消息 `new_msg`，从消息正文提取验证码并调用 `sendMsg(code)`；可开 `danMuMock` 同时把验证码打到本地弹幕 |

## 在线演示

| 页面 | 地址 | 说明 |
| ---- | ---- | ---- |
| [无后端集成](https://teakong.github.io/danmu/index.html) | `https://teakong.github.io/danmu/index.html` | 纯前端弹幕 + plugins=control 控制面板 + 弹幕发送 |
| [后端过滤系统](https://teakong.github.io/danmu/server.html) | `https://teakong.github.io/danmu/server.html` | 后端审核 + Redis 缓存 + 注册用户推送 |
| [最简集成](https://teakong.github.io/danmu/simple.html) | `https://teakong.github.io/danmu/simple.html` | 一行 script 标签集成示例 |

## 业务 Demo

> 展示组件在实际业务系统中的接入效果，可直接访问体验。

| Demo | 地址 | 说明 |
| ---- | ---- | ---- |
| [小纸条信箱](https://head.phprm.com/api/) | `https://head.phprm.com/api/` | 匿名弹幕留言信箱。使用 AI 弹幕组件读取 DOM 节点上的留言数据，发送给 AI 大模型自动生成弹幕，支持弹幕与留言系统相互打通。 |

**接入亮点：**
- **匿名留言**：用户无需注册即可留下小纸条
- **AI 自动弹幕**：弹幕组件读取留言 DOM 节点，调用 AI 大模型生成自然弹幕飞过屏幕
- **弹幕 ↔ 留言打通**：弹幕与留言系统双向联动，留言实时转化为弹幕

## 代码仓库

| 平台 | 地址 | 说明 |
| ---- | ---- | ---- |
| [GitHub](https://github.com/teakong/danmu) | `https://github.com/teakong/danmu` | 国际用户首选 |
| [Gitee 码云](https://gitee.com/teakong/danmu) | `https://gitee.com/teakong/danmu` | 国内用户加速访问 |

## 相关项目

| 项目 | 地址 | 说明 |
| ---- | ---- | ---- |
| push-server-frontend | `https://github.com/teakong/push-server-frontend` | 支持任意网站站长给注册会员集成多通道推送面板，一次推送，多端送达。 |

## 特性

- **一行代码集成**：引入 danmu.js 即自动加载依赖、连接通道、渲染弹幕
- **AI 弹幕**：自动识别当前浏览内容，定时轮询生成并推送 AI 弹幕
- **实时 WebSocket 推送**：基于 Socket.IO，消息低延迟到达
- **插件化架构**：组件只加载你点名的插件（`plugins=名字`）；插件脚本用 `registerPlugin(name, run)` 注册，复用同一条通道码，异常被组件捕获、不影响主流程
- **远端插件**：`plugins` 可直接写 `http(s)://…/x.js` 完整 URL 加载自托管插件（注册名取文件名去 `.js`），也可在 `init()` 传 `pluginsSite` 换插件目录
- **双消息流**：服务端发两种消息——`new_dm`（轻量：head + 头像，速度快）与 `new_msg`（完整：head + content + uid）；插件名以 `msg` 开头的订阅 `new_msg`，其余订阅 `new_dm`
- **左下角控制面板**：URL 加 `plugins=control` 即在左下角出现齿轮按钮，点开可调整不透明度/显示区域/字号/速度，并开关弹幕、恢复默认
- **右上角推送面板**：URL 加 `plugins=panel` 出现通道码/登录/弹幕设置面板（不加载时通道走无 UI 的自动认领）
- **弹幕发送输入框**：URL 加 `plugins=input`，右下角图标点击展开输入框，支持回车发送、Esc / × 关闭
- **统计与上报插件**：`stat`（访问/点击统计）、`axios-report`（接口异常）、`vue-report`（Vue 异常告警）、`ad`（图片广告位）
- **消息识别插件**：`msg-dialog`（聊天窗口）、`msg-sms-code`（短信验证码识别，可开 `danMuMock` 本地弹幕展示）
- **开关状态持久化**：弹幕开/关状态写入 localStorage，刷新页面自动恢复
- **后端过滤**：支持 danMuFilter 回调，业务方可异步校验弹幕合法性、查询点赞数
- **点赞 / 关闭交互**：每条弹幕支持点赞（带计数）、关闭/举报按钮
- **可配置**：透明度、字号、飞行速度、颜色、底部高度、点赞/关闭开关均可自定义
- **去重防刷**：按 item.id 去重，避免同一条弹幕重复飞过
- **生命周期管理**：提供 destroy() 方法销毁所有资源，支持重新初始化
- **无需后端开箱可用**：自带 server.php 演示，前端直接调用 jquery.barrager.js 也能渲染

## 目录结构

```
danmu/
├── index.html                 # 演示页（无后端集成 + plugins=control 控制面板 + 弹幕发送）
├── server.html                # 演示页（后端过滤 + Redis 缓存 + 注册用户推送）
├── simple.html                # 最简集成示例（一行 script 标签）
├── server.php                 # 弹幕服务端演示（init/filter/send 路由）
├── FileCache.php              # 文件缓存工具
├── KV.php                     # KV 缓存接口
├── RedisCache.php             # Redis 缓存实现
├── LICENSE
├── examples/                  # 示例与插件开发手册
│   ├── index.html             # 插件开发手册（在线版：push.phprm.com/plugins.html）
│   ├── msg-sms-code.html      # 短信验证码识别示例（可交互提取演示）
│   ├── stat.html / ad.html / panel.html      # 各插件示例
│   ├── axios-report.html / vue-report.html   # 异常上报示例
│   ├── offline.html / offline-danmu.html     # 离线接入示例
│   ├── multi.html             # 多实例示例
│   └── md2html/               # Markdown 转网页示例
└── static/
    ├── css/
    │   ├── barrager.css        # 弹幕样式（close/like 图标、背景、动画）
    │   ├── pusher.css          # 推送面板样式
    │   └── images/             # 弹幕图标与图片（close.svg / heart_*.svg / dan.png / *.gif）
    └── js/
        ├── danmu.js            # 一行集成入口（自动加载依赖 + 调用 init）
        ├── danmu-float.js      # 浮动挂件入口
        ├── pusher.js           # WebsitePusher 组件主体（推送 + 弹幕 IIFE）
        ├── kf.js               # 客服挂页脚本（提供全局 sendMsg 等）
        ├── jquery.barrager.js  # 弹幕渲染引擎（定制版：点赞/关闭/透明度/onAction）
        ├── jquery.min.js       # jQuery
        ├── socket.io.min.js    # Socket.IO 客户端
        ├── md5.js             # md5 工具
        ├── fingerprint2.min.js # 设备指纹（生成并固化访客 device id）
        ├── tinycolor-0.9.15.min.js  # 颜色处理（pick-a-color 依赖）
        ├── layer/              # 弹层组件（登录/推送窗口 UI）
        └── plugins/
            ├── panel.js        # 右上角推送面板（通道码/登录/弹幕设置/提醒列表），plugins=panel 启用
            ├── control.js      # 左下角齿轮 + 设置面板，plugins=control 启用
            ├── input.js        # 底部弹幕发送输入框，plugins=input 启用
            ├── stat.js         # 访问统计，plugins=stat 启用
            ├── ad.js           # 广告位，plugins=ad 启用
            ├── axios-report.js # axios 接口异常上报，plugins=axios-report 启用
            ├── vue-report.js   # Vue 异常告警上报，plugins=vue-report 启用
            ├── msg-dialog.js   # 聊天窗口消息插件（msg* → new_msg 完整消息）
            └── msg-sms-code.js # 短信验证码识别（msg* → new_msg；支持 danMuMock 开关）
```

## 快速开始

### 最简集成（一行代码）

在任意 HTML 页面引入一行 script 标签即可：

```html
<script src="static/js/danmu.js?appName=弹幕&channelCode=你的通道码&danMu=1"></script>
```

或直接使用云端服务：

```html
<script src="https://ws.phprm.com/static/customer/js/danmu.js?appName=弹幕&channelCode=4d05f4abdb0a0c2a0269900809946903&danMu=1"></script>
```

danmu.js 会按序自动加载 md5.js / socket.io.min.js / jquery.barrager.js / pusher.js 与 barrager.css，就绪后调用 WebsitePusher.init() 连接 WebSocket 通道，实时接收并渲染弹幕。

**URL 参数说明：**

| 参数 | 说明 |
| ---- | ---- |
| appName | 应用名称（必填，用于数据统计）；不传且不写 `autoInit=0` 时不会自动初始化 |
| channelCode | 推送通道码，到<a href="https://push.phprm.com/" target="_blank" rel="noopener">弹幕云服务官网</a>注册后获取；不传则按当前网址自动认领 |
| danMu | 1=开启弹幕，0=关闭（仍做推送/统计；加载 `ad` 插件时照常展示广告位） |
| aiDanMu | AI 弹幕轮询间隔（秒），0=关闭 |
| hideDialog | 1=隐藏推送对话框 |
| plugins | 要加载的插件，英文逗号分隔（如 `stat` / `panel` / `stat,ad`）；也支持写完整 URL 加载远端插件（如 `https://你的域名/msg-foo.js`）。名字以 `msg` 开头的插件订阅完整消息 `new_msg`，其余订阅轻量的 `new_dm`。左下角控制面板由 `control` 决定，右上角面板由 `panel` 决定，底部发送框由 `input` 决定；不传=不加载插件（旧参数 hidePanel 已废弃） |
| hideIcon | 1=隐藏右下角浮窗图标 |
| autoInit | 0=只加载依赖不初始化，之后监听 `websitePusherReady` 事件自行调用 `WebsitePusher.init()` |

> `pluginsSite`（插件目录）不能在脚本地址上传，只能在 `init()` 里传；`insertNode.js` 加载器支持在 script 地址上传该参数，详见[在线插件手册](https://push.phprm.com/plugins.html)。

### 高级集成（自定义配置）

```javascript
WebsitePusher.init({
    appName: "我的弹幕",
    channelCode: "你的通道码",
    danMu: 1,
    plugins: "",      // 要加载的插件，英文逗号分隔，如 "stat,ad"；右上角面板写 "panel"
    hideDialog: 1,
    danMuSetting: {
        opacity: 50,       // 背景不透明度 0~100
        size: 20,          // 字号 8~33
        speed: 18,         // 飞行秒数
        like: 1,           // 显示点赞按钮
        close: 0,          // 不显示关闭按钮
        color: "#fff",     // 文字颜色
        aiDanMu: 30,       // 每30秒轮询一次AI弹幕云服务，AI大模型识别当前网页自动生成弹幕
        selector: "body"   // 默认选择body, 可通过公开API: setDanMuArea设置区域
    },
    // 弹幕初始化闸门：return false 时不创建 socket 连接
    danMuInitCallback: function (settings) {
        var enabled = localStorage.getItem("danmu_enabled");
        return enabled !== "0";
    },
    // 右下角弹幕图标首次点击（开启弹幕发送）
    danMuSendOpen: function (settings) {
        localStorage.setItem("danmu_enabled", "1");
        // 创建弹幕发送输入框...
    },
    // 右下角弹幕图标再次点击（关闭弹幕发送）
    danMuSendClose: function (settings) {
        localStorage.setItem("danmu_enabled", "0");
        // 移除弹幕发送输入框...
    },
    // 弹幕发送后回调（异步推送到后端）
    sendCallback: function (item, settings) {
        $.getJSON('server.php', {
            type: 'send',
            channelCode: settings.channelCode,
            head: item.info
        });
    }
});
```

### 本地演示

直接双击浏览器访问：

```
http://localhost/danmu/index.html       # 无后端集成演示
http://localhost/danmu/simple.html      # 最简集成示例
```

把整个目录放到 PHP 环境（如 XAMPP / phpStudy），浏览器访问：

```
http://localhost/danmu/server.html      # 后端过滤演示
http://localhost/danmu/examples/index.html  # 插件开发手册（含各示例页入口）
```

## WebsitePusher 公开 API

### init(options)

接入入口。options 为 settings 覆盖项，嵌套对象（如 danMuSetting）按字段深合并。

### 运行时控制方法

| 方法 | 说明 |
| ---- | ---- |
| init(options) | 接入入口，options 为 settings 覆盖项 |
| registerPlugin(name, run) | 注册插件，脚本加载后执行 `run(settings)`，每个插件文件调用一次 |
| destroy() | 销毁所有资源（DOM/事件/Socket.IO/定时器/缓存），销毁后可重新调用 init() |
| stopDanMu() | 停止弹幕：断开 Socket.IO、停 AI 轮询、清屏，保留 token 供恢复 |
| startDanMu() | 启动弹幕：重连 Socket.IO、重启 AI 轮询。返回 false 表示 token 不存在无法启动 |
| sendDanMu(item) | 主动发送一条弹幕（仅当前屏幕滚动，不请求后端）；`item.info` 为弹幕文字，id 缺省自动生成 local_ 前缀 |
| updateDanMu(options) | 更新弹幕配置并立即生效（外观/AI 轮询） |
| hideDanMu() | 隐藏弹幕（visibility:hidden，动画继续不丢消息） |
| showDanMu() | 显示弹幕（移除 hideDanMu 的隐藏样式） |
| pauseDanMu() | 暂停弹幕（冻结滚动，新消息暂存队列） |
| resumeDanMu() | 恢复弹幕（重启滚动，刷新暂存队列） |
| clearDanMu() | 清屏（移除所有弹幕元素 + 清空暂停队列，不影响连接） |
| setDanMuArea(ratio) | 设置显示区域比例（0.1~1，如 0.5=上半屏） |
| pushTrigger(head, body, url, avatar, callback) | 上报一条推送（插件/宿主统一入口），POST 到 `triggerUrl`，url=访问网址(传空回退当前网址)，avatar=头像(传空不写入)，callback=完成回调(入参为是否成功) |
| waitChannelCode(onReady, onTimeout) | 等待通道码认领就绪（200ms 轮询，默认 10 秒超时），插件上报前可用 |

### settings 配置项

| 分类 | 字段 | 说明 |
| ---- | ---- | ---- |
| 基础 | siteName / apiKey / cssSite / jsSite | apiKey 为服务端鉴权契约，勿改名 |
| 地址 | pcUrl / pushUrl / apiUrl / authUrl / wsUrl / channelMemberUrl / triggerUrl | 弹幕云服务固定地址；triggerUrl 为插件上报接口前缀 |
| 插件 | plugins / pluginsSite / danMuMock | plugins=插件名(英文逗号分隔，可含完整 URL)；pluginsSite=插件目录(仅 init 可传)；danMuMock=1 时 msg-sms-code 识别到验证码同时本地弹幕展示 |
| 用户态 | channelCode / uid / name / createTime / token / avatar / device / clientVersion / screenResolution / userPlatformType / userPlatformVersion | — |
| 行为开关 | hideDialog(0/1) / danMu(0/1) / plugins(插件名, 英文逗号分隔) | hideIcon(0/1) 控制右下角浮窗；左下角控制面板由 plugins 里的 control 决定，右上角面板由 panel 决定，hidePanel 已废弃 |
| 文案 | closeText | 弹幕关闭按钮自定义文案 |
| 消息 | messageLength | messageIdList 容量上限，默认 20000 |

### danMuSetting 配置项

| 分类 | 字段 | 说明 |
| ---- | ---- | ---- |
| 外观 | opacity(0~100) / size(8~33) / speed(飞行秒数) / color(文字颜色) / bottom(底部偏移px) | — |
| 开关 | close(0/1) / like(0/1) / selector(挂载选择器，默认 body) | — |
| AI | aiDanMu(轮询秒数，0=关) / aiDanMuUrl(AI接口，空则回退 apiUrl) / bottomradio(固定底部开关) | — |
| 浮窗 | hideIcon(0/1) | 是否隐藏右下角浮窗图标 |

### 回调钩子

均为 settings 属性，回调内 this 指向 settings：

| 钩子 | 签名 | 说明 |
| ---- | ---- | ---- |
| configCallback | (params) => boolean | 打开客服窗口前的拦截，false 则不打开 |
| danMuInitCallback | (settings) => boolean | 弹幕初始化闸门，false 则不创建 socket 连接（token 仍保存供 startDanMu 恢复） |
| danMuSendOpen | (settings) => any | 右下角弹幕图标首次点击时触发（开启弹幕发送） |
| danMuSendClose | (settings) => any | 右下角弹幕图标再次点击时触发（关闭弹幕发送） |
| newMsgCallback | (message) => any | 在 `msg*` 插件里设置，接收完整消息对象（head + content + uid 等）；多个插件都要处理时用 `pushNewMsg` DOM 事件避免覆盖 |
| danMuMessageCallback | (message) => boolean | 原始消息闸门（拆成弹幕 item 之前），返回 true 表示已自行处理、不再渲染成弹幕 |
| danMuFilter | (item) => any | 每条弹幕分发入口（默认走过滤链） |
| danMuFilterCallback | (item, cb) => any | 内部方法，不允许重写；按 item.id 去重 + info 非空校验 |
| danMuPopCallback | (dom, item) => any | 弹幕挂载后回调，默认绑定 onAction(barrage, action) |
| checkAiDanMu | (doc, pollCount) => any | AI 弹幕轮询入口；pollCount 为第 N 次轮询 |
| sendCallback | (item, settings) => any | sendDanMu 发送完成后的回调 |

## 弹幕分发链路

一条弹幕从远端到屏幕的完整流程：

```
后端消息
  -> resolveStreamMode(按插件名前缀决定订阅 new_dm / new_msg)
  -> msg* 插件: newMsgCallback / pushNewMsg DOM 事件(完整消息)
  -> 其余插件: SocketIO 监听
  -> danMuMessageCallback(原始消息闸门, true 则整条跳过)
  -> buildBarragerItem(套用 danMuSetting 默认值)
  -> danMuFilter(业务方异步校验/查询点赞数)
  -> danMuFilterCallback(去重/校验)
  -> danMuPopCallback(设置 onAction)
  -> $(selector).barrager(item) 渲染
  -> 交互走 jquery.barrager.js
```

## 插件系统

### 加载机制

一个插件就是一个 JS 文件，用 `WebsitePusher.registerPlugin(name, run)` 注册 run 函数，再在 `plugins` 里写插件名即可加载：

```javascript
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) return;
    WebsitePusher.registerPlugin("mynote", function (settings) {
        console.log("mynote 已启动，通道码=" + settings.channelCode);
        WebsitePusher.pushTrigger("mynote", "hello 自定义插件");
    });
})();
```

- 运行流程：加载 danmu.js → 读取 `plugins` / `pluginsSite` → 加载 pusher → 依次加载插件脚本 → `registerPlugin(名字, run)` → 执行 `run(settings)`。
- 不写 `plugins` 就不加载任何插件，也没有右上角面板，只有挂件默认行为。
- 插件异常被组件捕获，不影响弹幕/统计主流程；控制台按 `[网页插件]` 过滤可看每个插件的加载日志（`✓` 成功 / `✗` 给出具体原因）。
- 发布时文件名必须与插件名一致，放到 `danmu.js` 同级的 `plugins/`（线上为 `static/customer/js/plugins/`）。

详细开发指南见 [examples/index.html](examples/index.html) 或[在线插件手册](https://push.phprm.com/plugins.html)。

### 消息流：new_msg 与 new_dm

为提升速度，服务端发两种消息，挂件只订阅其中一种，由**插件名前缀**决定：

| 插件名 | 订阅事件 | 消息体 | 适用场景 |
| ---- | ---- | ---- | ---- |
| 以 `msg` 开头（不分大小写），如 `msg-dialog`、`msg-sms-code` | `new_msg` | 完整消息（head + content + uid 等） | 渲染消息、识别验证码等需要正文的场景 |
| 其他名字，如 `stat`、`ad`、`panel` | `new_dm` | 轻量消息（head + 头像） | 统计、广告、弹幕，不需要正文，速度更快 |

远端 URL 插件同样遵守该规则：注册名取 URL 末段去 `.js` 后再判断是否以 `msg` 开头，例如 `https://x.com/msg-foo.js` 命中 `msg` 前缀，订阅完整消息。

在 `msg*` 插件的 `run(settings)` 里设置 `settings.newMsgCallback` 接收完整消息；多个插件都要处理完整消息时，改用 `pushNewMsg` DOM 事件（完整消息在 `event.detail`）避免回调互相覆盖。收到消息后若再调用 `sendMsg()`，该消息会被广播回来形成回环，务必按消息 ID 和内容双重去重。

### 官方插件清单

| 插件 | 说明 |
| ---- | ---- |
| panel | 右上角面板：通道码、登录账户、增加通道、弹幕设置，以及打开/关闭面板的 API |
| control | 左下角齿轮设置面板（不透明度/区域/字号/速度 + 弹幕开关 + 恢复默认） |
| input | 底部弹幕发送输入框，回车发送、Esc/× 关闭 |
| stat | 访问统计：加载上报 `visit`，点击上报 `click` |
| ad | 右下角图片广告位，可关闭、可按时长自动消失，建议配 `danMu=0` |
| axios-report | axios 接口异常上报（`head=axios`），建议配 `danMu=0&hideDialog=1&hideIcon=1` |
| vue-report | Vue 异常与告警上报（`head=vue`），参数同上 |
| msg-dialog | 聊天窗口消息插件（`msg*` → `new_msg` 完整消息），提供全局 `sendMsg(text)` |
| msg-sms-code | 识别消息里的短信验证码并调用 `sendMsg(code)`；`msg*` → `new_msg`，与 `msg-dialog` 二选一（都写 `newMsgCallback`）；`init({ danMuMock: 1 })` 时同时用 `sendDanMu({info: code})` 打到本地弹幕 |

也可到[书签挂件页](https://push.phprm.com/clipper.html)把官方插件书签拖到浏览器地址栏立即体验。

## 左下角控制面板（plugins=control）

URL 上加上 `plugins=control` 就会初始化左下角控制面板，不需要额外引入脚本：

```html
<script src="https://ws.phprm.com/static/customer/js/danmu.js?appName=弹幕&channelCode=你的通道码&danMu=1&plugins=control"></script>
```

也可以写进 `WebsitePusher.init({ plugins: "control" })`，并和其它插件用逗号同时加载（如 `plugins=control,stat`）。

左下角是一个圆形齿轮按钮，点击展开/收起设置面板：

- 滑块：不透明度 / 显示区域 / 字号 / 弹幕速度，拖动即时生效
- **「弹幕」勾选框**：开启/关闭弹幕（等价于 startDanMu / stopDanMu）
- **恢复默认**：把四项参数重置为默认值，并重新打开弹幕

弹幕开/关状态通过 localStorage key `danmu_enabled` 持久化：

- `"1"` 或不存在 -> 开启（创建 socket 连接）
- `"0"` -> 关闭（不创建 socket 连接，token 仍保存）

`danMuInitCallback` 读取 localStorage 决定是否创建 socket 连接，面板的开关会写入同一个 key。

插件在 `static/js/plugins/control.js`，按钮图标已内联，不需要额外图片资源。业务方要做成自己的 UI 时，保留 `stopDanMu` / `startDanMu` / `updateDanMu` / `setDanMuArea` 这组公开 API 即可。

## 弹幕发送输入框（plugins=input）

URL 上加上 `plugins=input`，点击右下角弹幕图标即展开底部发送框，不需要自己写 `danMuSendOpen`：

```html
<script src="https://ws.phprm.com/static/customer/js/danmu.js?appName=弹幕&channelCode=你的通道码&danMu=1&plugins=input"></script>
```

也可以写进 `WebsitePusher.init({ plugins: "input" })`，并和其它插件用逗号同时加载（如 `plugins=control,input`）。

- 点击图标展开，再次点击图标收起；回车发送，Esc 或右上角 × 关闭
- 发送走触发推送接口 `GET {triggerUrl}{channelCode}?head=弹幕内容&avatar=&url=当前网址`，所有订阅同一通道的页面都能收到
- `url` 会带上 `pushTime=HH:MM:SS`：后端对同一 `url` 参数的触发 1 分钟内去重，不带时间戳时同页连发会出现「发送成功但没有弹幕」；网址本身已有 `pushTime` 时替换旧值，不会追加成两个
- 关闭时会把 `settings.danMuSendOpened` 复位，图标下一次点击仍然是展开输入框
- 宿主自己实现了 `danMuSendOpen` / `danMuSendClose` 时，插件会先执行宿主回调再展开/收起输入框

插件在 `static/js/plugins/input.js`，样式内联、不依赖 jQuery；输入框 id 为 `dm-send-box`，`destroy()` 会自动清除。

## 无后端/后端集成

### 场景一：无后端（纯前端弹幕）

前端调用 $.getJSON()所有监听同一个通道的浏览器页面均可见, 只支持danMuSetting.close不支持danMuSetting.like

```javascript
$.getJSON("https://www.phprm.com/services/push/trigger/4d05f4abdb0a0c2a0269900809946903?head=这是第一条弹幕&avatar=https://www.phprm.com/push/h5/static/avatar/danMu.png");
```

### 场景二：后端过滤（注册用户推送）

通过 danMuFilter 回调，业务方可异步校验弹幕合法性、查询点赞数（支持danMuSetting.like=1）：

```javascript
danMuFilter: function (item) {
    var _this = this;
    $.getJSON('server.php', {
        type: 'filter',
        messageId: item.id,
        bizId: "1"
    }, function(resp) {
        if (resp.code != 0 || !resp.data) return;
        item.num = resp.data.likeCount || 0;
        _this.danMuFilterCallback(item, function (dom) {
            _this.danMuPopCallback(dom, item);
        });
    });
}
```

**后端 server.php 路由：**

| 路由 | 说明 |
| ---- | ---- |
| type=init | 弹幕初始化，绑定业务 ID 与通道码，发送欢迎弹幕，缓存 messageIdList |
| type=filter | 校验弹幕消息 ID 合法性，查询关联业务数据与点赞数 |
| type=send | 业务后端调用推送 API，将 messageIdList 缓存到 Redis 供 filter 校验 |
| type=checkAiDanMu | 业务后端调用大模型接口识别当前访问网页的内容生成弹幕推送 API，所有人可见 |

## 兼容性

- 严格 ES5，支持 IE / GBK 页面
- 低版本 jQuery（<1.7）无 on/off 时，danmu.js 会自动用 bind/unbind + delegate/undelegate 兼容
- IE < 9 不兼容 CSS 圆角，采用兼容样式，可单独设置弹幕颜色 old_ie_color，建议不要与网页主背景色相同
- localStorage 不可用时自动回退 cookie，兼容 IE6/7 及 file:// 等异常环境

## 致谢

- 弹幕渲染引擎基于开源项目 [jquery.barrager.js](https://github.com/yaseng/jquery.barrager.js)（作者 yaseng）二次开发
