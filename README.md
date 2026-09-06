# AI弹幕组件

一行代码，为任意网站接入弹幕系统。支持 AI 自动弹幕、WebSocket 实时推送、点赞/关闭交互、后端审核过滤，适用于个人博客、直播、评论系统等场景，无需后端开箱可用。

## 特性

- **一行代码集成**：引入 danmu.js 即自动加载依赖、连接通道、渲染弹幕
- **AI 弹幕**：自动识别当前浏览内容，定时轮询生成并推送 AI 弹幕
- **实时 WebSocket 推送**：基于 Socket.IO，消息低延迟到达
- **浮窗控制面板**：右下角浮动图标，支持停止/启动弹幕、调整透明度/字号/速度/显示区域
- **弹幕发送输入框**：右下角图标点击展开输入框，支持回车发送、关闭按钮
- **开关状态持久化**：弹幕开/关状态写入 localStorage，刷新页面自动恢复
- **后端过滤**：支持 danMuFilter 回调，业务方可异步校验弹幕合法性、查询点赞数
- **点赞 / 关闭交互**：每条弹幕支持点赞（带计数）、关闭/举报按钮
- **可配置**：透明度、字号、飞行速度、颜色、底部高度、点赞/关闭开关均可自定义
- **去重防刷**：按 item.id 去重，避免同一条弹幕重复飞过
- **生命周期管理**：提供 destroy() 方法销毁所有资源，支持重新初始化
- **无需后端开箱可用**：自带 server.php 演示，前端直接调用 jquery.barrager.js 也能渲染

## 目录结构

```
AiDanMu/
├── index.html                 # 演示页（无后端集成 + 浮窗控制 + 弹幕发送）
├── server.html                # 演示页（后端过滤 + Redis 缓存 + 注册用户推送）
├── simple.html                # 最简集成示例（一行 script 标签）
├── server.php                 # 弹幕服务端演示（init/filter/send 路由）
├── FileCache.php              # 文件缓存工具
├── KV.php                     # KV 缓存接口
├── RedisCache.php             # Redis 缓存实现
├── LICENSE
└── static/
    ├── css/
    │   ├── barrager.css        # 弹幕样式（close/like 图标、背景、动画）
    │   ├── pusher.css          # 推送面板样式
    │   └── images/             # 弹幕图标与图片
    │       ├── dan-hover.svg   # 弹幕运行中图标
    │       ├── dan-close.svg   # 弹幕已停止图标
    │       ├── dan-config.svg  # 弹幕设置图标
    │       ├── close.svg  heart_default.svg  heart_hover.svg  heart_liked.svg
    │       └── dan.png  *.gif
    └── js/
        ├── danmu.js            # 一行集成入口（自动加载依赖 + 调用 init）
        ├── pusher.js           # WebsitePusher 组件主体（推送 + 弹幕 IIFE）
        ├── danmu-float.js      # 浮窗控制面板（停止/启动/设置面板）
        ├── jquery.barrager.js  # 弹幕渲染引擎（定制版：点赞/关闭/透明度/onAction）
        ├── jquery.min.js       # jQuery
        ├── socket.io.min.js    # Socket.IO 客户端
        ├── md5.js             # md5 工具
        └── tinycolor-0.9.15.min.js  # 颜色处理（pick-a-color 依赖）
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
| appName | 应用名称（必填，用于数据统计） |
| channelCode | 推送通道码，到弹幕云服务官网注册后获取 |
| danMu | 1=开启弹幕，0=关闭 |
| aiDanMu | AI 弹幕轮询间隔（秒），0=关闭 |
| hideDialog | 1=隐藏推送对话框 |
| hidePanel | 1=隐藏推送面板 |
| hideIcon | 1=隐藏右下角浮窗图标 |

> 依赖路径按 danmu.js 自身所在目录解析，无论宿主页面放在哪都能正确加载。

### 高级集成（自定义配置）

```javascript
WebsitePusher.init({
    appName: "我的弹幕",
    channelCode: "你的通道码",
    danMu: 1,
    hidePanel: 1,
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
http://localhost/AiDanMu/index.html       # 无后端集成演示
http://localhost/AiDanMu/simple.html      # 最简集成示例
```

把整个目录放到 PHP 环境（如 XAMPP / phpStudy），浏览器访问：

```
http://localhost/AiDanMu/server.html      # 后端过滤演示
```

## WebsitePusher 公开 API

### init(options)

接入入口。options 为 settings 覆盖项，嵌套对象（如 danMuSetting）按字段深合并。

### 运行时控制方法

| 方法 | 说明 |
| ---- | ---- |
| init(options) | 接入入口，options 为 settings 覆盖项 |
| destroy() | 销毁所有资源（DOM/事件/Socket.IO/定时器/缓存），销毁后可重新调用 init() |
| stopDanMu() | 停止弹幕：断开 Socket.IO、停 AI 轮询、清屏，保留 token 供恢复 |
| startDanMu() | 启动弹幕：重连 Socket.IO、重启 AI 轮询。返回 false 表示 token 不存在无法启动 |
| sendDanMu(item) | 主动发送弹幕（仅当前屏幕滚动，不请求后端） |
| updateDanMu(options) | 更新弹幕配置并立即生效（外观/AI 轮询） |
| hideDanMu() | 隐藏弹幕（visibility:hidden，动画继续不丢消息） |
| showDanMu() | 显示弹幕（移除 hideDanMu 的隐藏样式） |
| pauseDanMu() | 暂停弹幕（冻结滚动，新消息暂存队列） |
| resumeDanMu() | 恢复弹幕（重启滚动，刷新暂存队列） |
| clearDanMu() | 清屏（移除所有弹幕元素 + 清空暂停队列，不影响连接） |
| setDanMuArea(ratio) | 设置显示区域比例（0.1~1，如 0.5=上半屏） |

### settings 配置项

| 分类 | 字段 | 说明 |
| ---- | ---- | ---- |
| 基础 | siteName / apiKey / cssSite / jsSite | apiKey 为服务端鉴权契约，勿改名 |
| 地址 | pcUrl / pushUrl / apiUrl / authUrl / wsUrl / channelMemberUrl | 弹幕云服务固定地址 |
| 用户态 | channelCode / uid / name / createTime / token / avatar / device / clientVersion / screenResolution / userPlatformType / userPlatformVersion | — |
| 行为开关 | hideDialog(0/1) / hidePanel(0/1) / danMu(0/1) | hideIcon(0/1) 控制右下角浮窗 |
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
| danMuFilter | (item) => any | 每条弹幕分发入口（默认走过滤链） |
| danMuFilterCallback | (item, cb) => any | 内部方法，不允许重写；按 item.id 去重 + info 非空校验 |
| danMuPopCallback | (dom, item) => any | 弹幕挂载后回调，默认绑定 onAction(barrage, action) |
| checkAiDanMu | (doc, pollCount) => any | AI 弹幕轮询入口；pollCount 为第 N 次轮询 |
| sendCallback | (item, settings) => any | sendDanMu 发送完成后的回调 |

## 弹幕分发链路

一条弹幕从远端到屏幕的完整流程：

```
弹幕消息
  -> SocketIO(监听到通道有新的弹幕)
  -> buildBarragerItem(套用 danMuSetting 默认值)
  -> danMuFilter(业务方异步校验/查询点赞数)
  -> danMuFilterCallback(去重/校验)
  -> danMuPopCallback(设置 onAction)
  -> $(selector).barrager(item) 渲染
  -> 交互走 jquery.barrager.js
```

## 浮窗控制面板参考示例（danmu-float.js）

该控件可使用AI编辑器开发替换, 页面左下角显示弹幕控制浮窗，包含两个图标：

- **左侧图标**（停止/启动弹幕）：点击切换弹幕运行状态，图标在 dan-hover.svg（运行中）和 dan-close.svg（已停止）之间切换
- **右侧图标**（设置面板）：点击弹出设置面板，支持调整透明度、显示区域、字号、速度

弹幕开/关状态通过 localStorage key `danmu_enabled` 持久化：

- `"1"` 或不存在 -> 开启（创建 socket 连接）
- `"0"` -> 关闭（不创建 socket 连接，token 仍保存）

danMuInitCallback 读取 localStorage 决定是否创建 socket 连接，danMuSendOpen/danMuSendClose 写入 localStorage。

所有开关样式、存储配置和交互逻辑由业务方自行定制开发(考虑到业务方的存储方式可能为localStorage或者后端数据库, 只提供公开API对接开发)

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

