/**
 * WebsitePusher —— 一封传话聚合推送 + 弹幕 组件（单文件 IIFE，依赖 jQuery）。
 * 版本：v1.1.2
 *
 * 接入入口：
 *   WebsitePusher.init(options)
 *     options 为 settings 的覆盖项；未传字段沿用默认值，嵌套对象(如 danMuSetting)按字段
 *     深合并。URL 参数 appName/device/clientVersion/screenResolution 会覆盖同名 setting。
 *
 * settings（外部契约，key 不可变更）：
 *   基础配置：siteName / apiKey / cssSite(iframe内CSS基础路径) /
 *             jsSite(JS/layui/插件默认基础路径) /
 *             pluginsSite(插件目录, 默认 jsSite/plugins/) /
 *             pcUrl / pushUrl / apiUrl / authUrl /
 *             wsUrl(socket.io地址) / channelMemberUrl(打开推送通道) /
 *             triggerUrl(触发推送接口, 插件上报用) / appName /
 *             closeText(弹幕关闭按钮自定义文案)
 *   插件：    plugins(插件名, 英文逗号分隔, 如 "stat" / "stat,foo", 可一次加载多个;
 *             也兼容写成文件名 "stat.js", 组件会去掉后缀;
 *             默认空=不加载任何插件, 需要右上角面板时必须显式写上 panel) /
 *             pluginsSite(插件目录, 默认 jsSite/plugins/; 目录内 name.js 即插件 name) /
 *             插件加载后调用 WebsitePusher.registerPlugin(name, run) 注册, run(settings) 由组件执行;
 *             可用的官方插件: stat(访问统计, 每次页面加载触发一条 head=visit 推送,
 *             元素被点击时再触发一条 head=click 推送, body 为被点元素的点击描述
 *             (祖先路径 + id/class + 文本片段 + 点击坐标, 不再是整段 outerHTML) /
 *             axios-report(axios 接口异常, head=axios, body 为异常 JSON) /
 *             vue-report(Vue2/3/4 异常与警告, head=vue, body 为异常 JSON) /
 *             ad(广告位: head=广告 的消息不渲染弹幕, 改为右下角广告图, 支持 url/hold) /
 *             panel(右上角面板: 面板外壳/推送窗口(通道码+登录+获取通道码)/弹幕设置表单/登录窗口,
 *                   登录态查询/登录提交/验证码/我的提醒列表也在插件内;
 *                   组件本身不再内置这些 UI, 也不默认加载; 不加载时弹幕走无 UI 的通道认领)
 *   用户态：  channelCode / uid / name / createTime / token / avatar / device /
 *             clientVersion / screenResolution / userPlatformType / userPlatformVersion
 *   行为开关：hideDialog(0/1) / danMu(0/1; danMu=0 不渲染弹幕与弹幕图标,
 *             但加载了 ad 插件时仍建立消息流、照常展示广告位)
 *   插件/宿主上报入口（插件上报统一走这里，避免各插件各自拼请求）：
 *     WebsitePusher.pushTrigger(head, body, callback)  触发一条推送：
 *              POST {triggerUrl}{channelCode}, 请求体为 JSON: {head, url, body}；
 *              正文(body)上限 5 万字符(超出截断), 不占 URL 长度, 也不会被网关按 URL 长度拒绝；
 *              通道码未认领时先等它就绪(最多10秒)，等不到则放弃并回调 false
 *     WebsitePusher.waitChannelCode(onReady, onTimeout)  等通道码就绪(200ms 轮询, 默认10秒超时)
 *   弹幕运行时控制（供外部开发者动态开关弹幕）：
 *     WebsitePusher.stopDanMu()   停止弹幕：断开Socket.IO、停AI轮询、清屏，保留token/doc供恢复
 *     WebsitePusher.startDanMu()  启动弹幕：重连Socket.IO、重启AI轮询(依赖stopDanMu前保存的上下文)
 *     WebsitePusher.updateDanMu(options)  更新弹幕配置并立即生效(外观/AI轮询), options为danMuSetting字段子集
 *     WebsitePusher.hideDanMu()          隐藏弹幕(visibility:hidden, 动画继续不丢消息)
 *     WebsitePusher.showDanMu()          显示弹幕(移除hideDanMu的隐藏样式)
 *     WebsitePusher.pauseDanMu()         暂停弹幕(冻结滚动, 新消息暂存队列)
 *     WebsitePusher.resumeDanMu()        恢复弹幕(重启滚动, 刷新暂存队列)
 *     WebsitePusher.setDanMuArea(ratio)   设置显示区域比例(0.1~1, 如0.5=上半屏)
 *     WebsitePusher.clearDanMu()          清屏(移除所有弹幕元素+清空暂停队列, 不影响连接)
 *   弹幕配置：danMuSetting{
 *       外观   opacity(0~100, 背景alpha=值/100) / size(8~33,字号) / speed(飞行秒数) /
 *              color(文字与省略号颜色) / bottom(底部偏移px)
 *       开关   close(0/1,关闭按钮) / like(0/1,点赞❤) / selector(弹幕挂载容器选择器,默认body)
 *       AI弹幕 aiDanMu(轮询秒数,0=关; 控制面板的"AI开关+间隔"表单只作UI, 保存时合并写回本字段) /
 *              aiDanMuUrl(AI弹幕接口,空则回退apiUrl) / bottomradio(表单固定底部开关)
 *   }
 *   回调钩子（均为 settings 属性，内部以 this.settings.xxx 调用，回调内 this 指向 settings）：
 *     configCallback(params)             -> boolean 打开客服窗口前的拦截，false 则不打开
 *     danMuInitCallback(settings)        -> boolean 弹幕初始化闸门，false 则禁用弹幕
 *     danMuSendOpen(settings)            -> any     右下角弹幕图标首次点击时触发(开启弹幕发送)
 *     danMuSendClose(settings)           -> any     右下角弹幕图标再次点击时触发(关闭弹幕发送)
 *     danMuMessageCallback(message)      -> boolean 原始消息闸门(在拆成弹幕item之前), 入参为后端推来的
 *                                                   原始 JSON(head/messageId/url/avatar/hold 等都在),
 *                                                   返回 true 表示调用方已自行处理该消息(例如广告位),
 *                                                   组件不再渲染这条弹幕; 默认 false
 *     danMuFilter(item)                  -> any     每条弹幕分发入口（默认走过滤链）
 *     danMuFilterCallback(item, cb)      -> any     按 item.id 去重 + info 非空校验，通过后
 *                                                   先回调 cb(selector, item) 让调用方设置
 *                                                   item.onAction 等字段, 再执行
 *                                                   $(danMuSetting.selector).barrager(item)
 *     danMuPopCallback(dom, item)        -> any     弹幕挂载后回调，默认给 item 绑定
 *                                                   onAction(barrage, action)，action='close'|'like'|'unlike'
 *     checkAiDanMu(doc, pollCount)  -> any     AI弹幕轮询入口（内部经 WebsitePusher 单例
 *                                                   访问状态与工具方法，重写时建议同样处理）；
 *                                                   pollCount 为当前第N次轮询, 首次调用不传默认1,
 *                                                   随 params.pollCount 上报后端
 *
 * 弹幕分发链路（一条消息的完整流程）：
 *   后端消息 -> danMuMessageCallback(原始消息闸门, true则整条跳过) -> buildBarragerItem(套用danMuSetting默认值)
 *   -> danMuFilter -> danMuFilterCallback(去重/校验) -> danMuPopCallback(设置onAction)
 *   -> $(selector).barrager(item) 渲染 -> 交互走 jquery.barrager.js
 *
 * 持久化：
 *   appKey       服务端鉴权契约，随 withCredentials 发送，勿改名
 *   deviceId     访客设备标识（localStorage+长期cookie双写，key=pusher_device_id；
 *               首次由Fingerprint2生成后固化复用, 浏览器升级/UA变化不再重算, 避免被识别为新设备）
 *   danMuConfig  弹幕表单配置 JSON（localStorage，key=pusher_danmu_config，客户端；
 *               localStorage不可用时自动回退cookie, 兼容IE6/7及file://等异常环境）
 *
 * 兼容：严格 ES5，支持 IE / GBK 页面。
 *
 * 公开方法：
 *   init(settings)       初始化弹幕/客服系统
 *   destroy()           销毁所有资源(DOM/事件/Socket.IO/定时器/缓存), 销毁后可重新 init
 *   stopDanMu()         停止弹幕(断开 Socket.IO, 保留 token 供恢复)
 *   startDanMu()        启动弹幕(恢复 Socket.IO, 依赖 stopDanMu 前保存的 token)
 *   sendDanMu(item)     主动发送一条弹幕(仅本地滚动, 不请求业务方后端)
 *   updateDanMu(opts)   更新弹幕配置并立即生效
 *   setDanMuArea(ratio) 设置弹幕显示区域比例
 */
try {
    /* ======================= WebsitePusher 组件主体（扁平方法 + 分区） ======================= */
    // IIFE 包裹: site 等内部常量留在闭包内不污染宿主 window, 仅 WebsitePusher 作为对外入口暴露
    var WebsitePusher = (function () {
        // 静态资源 CDN 根路径, settings.cssSite/jsSite 默认基于它拼接
        var site = "https://ws.phprm.com/static/";
        var WebsitePusher = {
            settings: {
                siteName: "一封传话聚合推送",
                apiKey: "amvk2ag1hwfswq",
                cssSite: site + "customer/css/",
                jsSite: site + "customer/js",
                pcUrl: "https://ws.phprm.com/pc.html",
                pushUrl: "https://push.phprm.com/",
                apiUrl: "https://www.phprm.com/push/h5/app/api/getDataInfo",
                authUrl: "https://www.phprm.com/oauth2",
                wsUrl: "https://2120ws.phprm.com",
                channelMemberUrl: "https://ws.phprm.com/api/channelMember.php",
                // 触发推送接口前缀(插件/宿主上报用): POST {triggerUrl}/{channelCode}, 请求体 JSON
                triggerUrl: "https://www.phprm.com/services/push/trigger/",
                // 插件目录: 目录内每个 name.js 即插件 name, 由 settings.plugins 指定要加载的插件
                pluginsSite: site + "customer/js/plugins/",
                // 插件名, 英文逗号分隔(如 "stat" 或 "stat,foo"), 可一次加载多个;
                // 默认空=一个插件都不加载; 右上角面板(推送窗口/登录窗口/弹幕设置)已拆到
                // plugins/panel.js, 需要面板时显式写 plugins: "panel"(可和别的插件并用 "stat,panel");
                // 不加载 panel 时组件不创建任何面板, 通道认领与弹幕走无 UI 的 initChannel()
                plugins: "",
                appName: "弹幕",
                channelCode: "",
                channelName: "",
                shareFlag: 1,
                group: 1,
                uid: "",
                name: "",
                createTime: "",
                token: "",
                avatar: "",
                device: "",
                clientVersion: "1.0",
                screenResolution: "",
                userPlatformType: "",
                userPlatformVersion: "",
                hideDialog: 0,
                danMu: 0,
                closeText: "关闭",
                danMuSetting: {
                    opacity: 50,
                    size: 20,
                    speed: 20,
                    close: 1,
                    like: 0,
                    bottom: 70,
                    bottomradio: 0,
                    aiDanMu: 0,
                    aiDanMuUrl: "",
                    selector: "body",
                    color: "#fff",
                    hideIcon: 0
                },
                // 上一次推送成功的messageIdList和容量限制
                messageIdList: new Array(),
                messageLength: 20,
                // 弹幕运行态: 暂停标记 / 暂停期间待渲染队列 / 去重用的 id 表(见 danMuFilterCallback)
                danMuPaused: false,
                danMuQueue: null,
                danMuSeenIds: null,
                danMuSeenCount: 0,
                sendCallback: function (item, settings) {
                    return true;
                },
                configCallback: function () {
                    return true;
                },
                danMuInitCallback: function (settings) {
                    // 这里可以插入网站启动弹幕send API, 当设置return false即使用户配置和url参数开启弹幕依然无法启用弹幕
                    return true;
                },
                danMuMessageCallback: function (message) {
                    // 原始消息闸门: 在拆成弹幕item之前拿到完整JSON(head/url/avatar/hold等),
                    // return true 表示调用方已自行处理该消息(例如广告位), 组件不再渲染这条弹幕
                    return false;
                },
                danMuSendOpen: function (settings) {
                    // 弹幕发送开启回调, 点击右下角图标第一次触发
                },
                danMuSendClose: function (settings) {
                    // 弹幕发送关闭回调, 点击右下角图标第二次触发
                },
                danMuSendOpened: false,
                danMuFilter: function (item) {
                    var _this = this;
                    // item.id即推送API返回的messageIdList里的第一个消息ID, 后端每次发送弹幕可关联业务评论ID与消息ID, 反查评论ID点赞数为0传给插件
                    item.num = 0;
                    // 每一条弹幕都可以回传给调用方判断是否展示, 允许异步方式过滤弹幕(例如根据item.id查询点赞次数), 也可以直接同步展示this.danMuPopCallback(item）
                    return this.danMuFilterCallback(item, function (dom) {
                        _this.danMuPopCallback(dom, item);
                    });
                },
                danMuFilterCallback: function (item, callback) {
                    // 按 item.id 进行重复性过滤: 已展示过的id直接丢弃, 避免同一条弹幕重复飞过(ES5兼容, Object map代替Set)
                    var id = item && item.id != null ? String(item.id) : "";
                    // 没有id的弹幕不给展示
                    if (id === "") {
                        return;
                    }
                    if (!this.danMuSeenIds) {
                        this.danMuSeenIds = {};
                        this.danMuSeenCount = 0;
                    }
                    if (this.danMuSeenIds[id]) {
                        return;
                    }
                    this.danMuSeenIds[id] = true;
                    this.danMuSeenCount += 1;
                    // 超过2000条重置, 防止长时间运行内存泄漏
                    if (this.danMuSeenCount > 2000) {
                        this.danMuSeenIds = {};
                        this.danMuSeenCount = 1;
                        this.danMuSeenIds[id] = true;
                    }
                    // info 去两侧空白后为空则不展示 (ES5兼容, String.prototype.trim代替正则)
                    var hasInfo = item && item.info != null;
                    var infoStr = hasInfo ? String(item.info) : "";
                    var trimmed =
                        hasInfo && typeof String.prototype.trim === "function"
                            ? infoStr.trim()
                            : infoStr.replace(/^\s+|\s+$/g, "");
                    if (trimmed === "") {
                        return;
                    }
                    // 自定义弹幕挂载节点或者样式: 从danMuSetting读取selector(js原生dom选择器字符串), 默认body
                    var dom = this.danMuSetting.selector || "body";
                    // 暂停时暂存到队列, 恢复时统一渲染(不丢消息)
                    if (this.danMuPaused) {
                        if (!this.danMuQueue) this.danMuQueue = [];
                        this.danMuQueue.push({ dom: dom, item: item, callback: callback });
                        return;
                    }
                    // 先回调让调用方设置 item.onAction 等字段, 再交给 barrager.js 渲染
                    // (barrager.js 内部 $.extend 会拷贝 item 快照, 后续修改原始 item 不会同步)
                    callback(dom, item);
                    $(dom).barrager(item);
                },
                danMuPopCallback: function (dom, item) {
                    // 给item绑定事件 (barrager.js 通过 .call(div_barrager[0], barrage, action) 触发, this 指向弹幕DOM)
                    item.onAction = function (barrage, action) {
                        // 这里可以根据action对弹幕进行操作
                        //  - action: 'close' 关闭 | 'like' 点赞 | 'unlike' 取消点赞
                        console &&
                        console.log("弹幕被点击:", action, "内容:", barrage.info);
                    };
                },
                checkAiDanMu: function (doc, pollCount) {
                    var _this = WebsitePusher;
                    var s = _this.settings;
                    pollCount =
                        typeof pollCount === "number" && pollCount > 0 ? pollCount : 1;
                    if (_this.danMuTimer) {
                        window.clearTimeout(_this.danMuTimer);
                    }
                    if (s.danMu != 1 || s.danMuSetting.aiDanMu <= 0) {
                        return;
                    }
                    if (!s.channelCode) {
                        return;
                    }
                    var headers = _this.getSignHeaders();
                    var body = _this.buildAiDanMuBody();
                    var params = {
                        type: "checkAiDanMu",
                        appKey: "pushBookmark",
                        channelCode: s.channelCode,
                        title: document.title,
                        body: body,
                        referer: window.location.href,
                        pollCount: pollCount,
                        _t: headers["apiTimestamp"],
                        settings: JSON.stringify(s)
                    };
                    _this.ajaxGet(
                        s.danMuSetting.aiDanMuUrl || s.apiUrl,
                        params,
                        headers,
                        function (resp) {
                            console.log("AI response：" + JSON.stringify(resp));
                            if (resp.code == 0 && resp.data) {
                                var data = resp.data;
                                if (!data["aiRestAmount"] || data["aiRestAmount"] <= 0) {
                                    _this.openPanel("setAiDanMuGroup", [doc, false]);
                                    return;
                                }
                                if (s.messageIdList.length > s.messageLength) {
                                    s.messageIdList.splice(
                                        0,
                                        s.messageIdList.length - s.messageLength,
                                    );
                                }
                                var aiMessageIdList = data["messageIdList"] || [];
                                for (var i = 0; i < aiMessageIdList.length; i++) {
                                    s.messageIdList.push(aiMessageIdList[i]);
                                }
                                _this.danMuTimer = window.setTimeout(function () {
                                    s.checkAiDanMu(doc, pollCount + 1);
                                }, s.danMuSetting.aiDanMu * 1000);
                            }
                        },
                        function () {},
                    );
                }
            },
            /* ===== 实例状态(数据成员统一放在所有方法之前, 方法只读写这里声明的字段) ===== */
            /**
             * 面板实例(由 panel 插件注册, 见 plugins/panel.js):
             * { openPusherWindow, openLoginWindow, toggle, addChannelInput, initDanMuConfigForm, setAiDanMuGroup }
             * 组件不再内置右上角面板/推送窗口/登录窗口的 DOM、事件绑定与登录逻辑,
             * 未加载 panel 插件时为 null, 相关入口不会创建任何面板
             */
            panel: null,
            // 插件注册表: name -> run(settings), 与 settings.plugins(配置的插件名)区分开
            pluginsRegistry: {},
            // 已加载过的插件名: 同一插件在页面内只注入/执行一次
            loadedPlugins: {},
            // 弹幕配置持久化的 localStorage/cookie key
            DK: "pusher_danmu_config",
            // 设备ID持久化的 localStorage/cookie key
            DEK: "pusher_device_id",
            // 当前通道的 Socket.IO 连接与令牌(danMuPop 建立, closePusher/stopDanMu 断开)
            danMuSocket: null,
            danMuSocketToken: null,
            // AI 弹幕轮询定时器
            danMuTimer: null,
            // 最近一次弹幕所在的文档(面板 iframe 或宿主 document), AI 轮询恢复时用
            danMuDoc: null,
            // 当前通道的 websocket 地址(服务端下发, 未下发时回退 settings.wsUrl)
            channelWsUrl: "",
            // 弹幕外观配置缓存(danMuPop 每次渲染时读取)
            cfgCache: null,
            // 已初始化的 appName(单例保护) 与 init 代次(并发 init 竞态)
            _initedAppName: null,
            _initGen: 0,
            // 插件脚本加载中的批次数(>0 表示插件还没就绪) 与等待插件就绪的回调队列
            pluginsLoading: 0,
            pluginsCallbacks: null,

            resetSettings: function () {
                var s = this.settings;
                s.channelCode = "";
                s.uid = "";
                s.name = "";
                s.createTime = "";
                s.token = "";
            },
            initSetting: function (options, callback) {
                var _this = this;
                var s = _this.settings;
                _this.resetSettings();
                _this.extend(s, options);
                var appName = this.getUrlParam("appName") || s.appName;
                var device = this.getUrlParam("device") || s.device;
                var version = this.getUrlParam("clientVersion") || s.clientVersion;
                // 优先级: URL 参数 > init options 传入 > 读取真实屏幕
                // 注意不能写成 getUrlParam(...) || s.screenResolution, 默认值非空会让下面的
                // 真实屏幕读取分支永不执行, 导致所有接入方都上报默认值
                var screenResolution = this.getUrlParam("screenResolution");
                if (appName) {
                    s.appName = appName;
                }
                if (s.danMu) {
                    s.siteName = s.appName;
                }
                if (version) {
                    s.clientVersion = version;
                }
                if (screenResolution) {
                    s.screenResolution = screenResolution;
                }
                // URL 参数和 init options 都未提供分辨率时, 读取真实屏幕宽高 (逗号分隔, 与其他来源格式一致)
                if (!s.screenResolution) {
                    try {
                        var w =
                            window.screen && window.screen.width
                                ? window.screen.width
                                : 0;
                        var h =
                            window.screen && window.screen.height
                                ? window.screen.height
                                : 0;
                        if (w > 0 && h > 0) {
                            s.screenResolution = String(w) + "," + String(h);
                        }
                    } catch (e) {}
                }
                if (!s.userPlatformType && !s.userPlatformVersion) {
                    var explorerInfo = this.getExplorerInfo();
                    s.userPlatformType = explorerInfo["type"];
                    s.userPlatformVersion = explorerInfo["version"];
                }
                // 加载插件目录中的插件(settings.plugins 指定); 放在设备/登录分支之前,
                // 保证插件不依赖 device/token 也能执行(如访问统计只需 channelCode)
                _this.loadPlugins();
                // settings 内存对象已保存所有字段, 无需再镜像到 DOM hidden input
                if (s.uid && s.token) {
                    if (callback) {
                        callback();
                    }
                    return;
                }
                if (device) {
                    s.device = device;
                    if (callback) {
                        callback();
                    }
                    return;
                }
                // 优先复用已持久化的设备ID: 浏览器升级会改变UA版本号/插件等指纹组件,
                // 实时重算 Fingerprint2 必然得到新ID; 首次生成后固化到 localStorage+cookie,
                // 之后直接复用, 不再重算, 浏览器升级/重装插件均不影响 (仅清缓存等极端场景才回退指纹)
                var persistedDevice = _this.getStoredDeviceId();
                if (persistedDevice) {
                    s.device = persistedDevice;
                    if (callback) {
                        callback();
                    }
                    return;
                }
                if (typeof Fingerprint2 === "undefined") {
                    this.parallelLoadScripts(
                        [s.jsSite + "/fingerprint2.min.js"],
                        function () {
                            _this.updateSettingDevice(callback);
                        },
                    );
                } else {
                    _this.updateSettingDevice(callback);
                }
            },
            updateSettingDevice: function (callback) {
                var _this = this;
                var finish = function (deviceId) {
                    // 首次生成后立即双写固化(localStorage+cookie), 此后 initSetting 直接读存储, 不再重算
                    _this.setStoredDeviceId(deviceId);
                    _this.settings.device = deviceId;
                    if (callback) {
                        callback();
                    }
                };
                // fingerprint2.min.js 加载失败等异常场景: 本地随机ID兜底, 同样持久化, 不影响后续流程
                if (
                    typeof Fingerprint2 === "undefined" ||
                    typeof Fingerprint2.get !== "function"
                ) {
                    finish(_this.genLocalDeviceId());
                    return;
                }
                Fingerprint2.get(function (components) {
                    var values = components.map(function (component, index) {
                        if (index === 0) {
                            return component.value.replace(/\bNetType\/\w+\b/, "");
                        }
                        return component.value;
                    });
                    finish(Fingerprint2.x64hash128(values.join(""), 31));
                });
            },
            getUrlParam: function (name) {
                var aQuery = window.location.href.split("?");
                var aGET = "";
                if (aQuery.length > 1) {
                    var aBuf = aQuery[1].split("&");
                    for (var i = 0; i < aBuf.length; i++) {
                        var aTmp = aBuf[i].split("=");
                        if (aTmp.length < 2) {
                            continue;
                        } else {
                            if (aTmp[0] == name) aGET = aTmp[1];
                        }
                    }
                }
                return aGET;
            },
            getExplorerInfo: function () {
                var ua = navigator.userAgent.toLocaleLowerCase();
                var browser = {
                    type: "Chrome",
                    version: 0,
                };
                try {
                    var rules = [
                        { p: /msie|trident/, t: "IE", v: /msie ([\d.]+)|rv:([\d.]+)/ },
                        { p: /edg/, t: "Edge", v: /edg\/([\d.]+)/ },
                        { p: /firefox/, t: "Firefox", v: /firefox\/([\d.]+)/ },
                        { p: /ucbrowser/, t: "UCBrowser", v: /ucbrowser\/([\d.]+)/ },
                        { p: /opera|opr/, t: "Opera", v: /opera\/([\d.]+)|opr\/([\d.]+)/ },
                        {
                            p: /baidubrowser/,
                            t: "Baidubrowser",
                            v: /baidubrowser\/([\d.]+)/,
                        },
                        {
                            p: /sogou|metasr/,
                            t: "Sogou",
                            v: /sogou\/([\d.]+)|metasr ([\d.]+)/,
                        },
                        {
                            p: /tencenttraveler|qqbrowser/,
                            t: "qqbrowser",
                            v: /tencenttraveler\/([\d.]+)|qqbrowser\/([\d.]+)/,
                        },
                        {
                            p: /micromessenger/,
                            t: "Micromessenger",
                            v: /micromessenger\/([\d.]+)/,
                        },
                        { p: /maxthon/, t: "maxthon", v: /maxthon\/([\d.]+)/ },
                    ];
                    var matched = false;
                    for (var i = 0; i < rules.length; i++) {
                        if (rules[i].p.test(ua)) {
                            browser.type = rules[i].t;
                            var m = ua.match(rules[i].v);
                            if (m) {
                                browser.version = m[1] || m[2] || m[0];
                            }
                            matched = true;
                            break;
                        }
                    }
                    if (!matched) {
                        if (ua.match(/chrome/) != null) {
                            function _mime(option, value) {
                                var mimeTypes = navigator.mimeTypes;
                                for (var mt in mimeTypes) {
                                    if (mimeTypes[mt][option] == value) {
                                        return true;
                                    }
                                }
                                return false;
                            }
                            browser.type = _mime(
                                "type",
                                "application/vnd.chromium.remoting-viewer",
                            )
                                ? "WOW64"
                                : "Chrome";
                            browser.version = ua.match(/chrome\/([\d.]+)/)[1];
                        } else if (ua.match(/safari/) != null) {
                            browser.type = "Safari";
                            var vRegex =
                                ua.indexOf("version") == -1
                                    ? /safari\/([\d.]+)/
                                    : /version\/([\d.]+)/;
                            browser.version = ua.match(vRegex)[1];
                        }
                    }
                } catch (error) {}
                return browser;
            },
            /**
             * 转发到 panel 插件的方法(插件未加载时返回 false)
             */
            openPanel: function (method, args) {
                var panel = this.panel;
                if (!panel || typeof panel[method] != "function") {
                    return false;
                }
                return panel[method].apply(panel, args || []);
            },
            /**
             * 打开推送窗口(右上角面板): 通道码覆盖/单例清理在组件, 面板UI与事件绑定在 panel 插件;
             * 未加载 panel 插件时不建任何 UI, 只认领通道并启动弹幕(见 initChannel)
             * @param {Boolean} checkLoginStatus 是否自动查询登录态(用户点匿名推送时传 false)
             * @param {String} [channelCode] 本次 init 传入的通道码(覆盖共享 s.channelCode, 防并发 init 竞态)
             */
            initPusherWindow: function (checkLoginStatus, channelCode) {
                var s = this.settings;
                // 用本次 init 传入的 channelCode 覆盖共享 s.channelCode, 防止并发 init 竞态
                // 未传 channelCode(undefined) 时按空字符串处理, 确保走 if(!s.channelCode) 分支不请求
                s.channelCode = channelCode || "";
                this.closePusher(true);
                var panel = this.panel;
                if (panel && typeof panel["openPusherWindow"] == "function") {
                    return this.openPanel("openPusherWindow", [checkLoginStatus, channelCode]);
                }
                // 没有 panel 插件: 不建面板, 但通道认领与弹幕不能丢
                return this.initChannel(channelCode);
            },
            channelMemberFail: function (resp, input, group, channelCodes) {
                var _this = this;
                console &&
                console.error(channelCodes + "查询浏览器通道异常, 无法弹出挂件");
                // hideDialog=1 时本来就不要弹窗(客服挂件/通道码输入框都不弹), 只把错误文案写到通道码下方;
                // 否则才按面板是否可见决定弹 layer 输入框(无面板时 #pushWebAnonymous 不存在, is(":hidden") 为 true)
                if (!this.settings.hideDialog && $("#pushWebAnonymous").is(":hidden")) {
                    $("<link>", {
                        rel: "stylesheet",
                        href: _this.settings.jsSite + "/layer/theme/default/layer.css",
                    }).appendTo("head");
                    _this.parallelLoadScripts(
                        [
                            _this.settings.jsSite + "/layui/layui.min.js",
                            _this.settings.jsSite + "/layui/lay/modules/layer.js",
                            _this.settings.jsSite + "/md5.js",
                        ],
                        function () {
                            // 弹出输入框并获取输入值
                            layer.prompt(
                                {
                                    id: channelCodes,
                                    formType: 0,
                                    value: "",
                                    title: resp.message + ", 请输入其他通道码",
                                },
                                function (value, index) {
                                    if (value.length != 32) {
                                        // 创建警告框
                                        layer.alert("通道码为32位字母和数字组成", {
                                            icon: 6,
                                            title: "警告",
                                            btn: ["确认"],
                                            yes: function (index, layero) {
                                                // 按钮回调函数
                                                layer.close(index);
                                            },
                                        });
                                        return;
                                    }
                                    // 输入框回填通道码后直接认领:
                                    // 不依赖面板里的 .pusher-button(panel 插件未加载时页面上没有该元素)
                                    group.find("input[name='channelCode']").val(value);
                                    _this.claimChannel(
                                        value,
                                        input,
                                        group,
                                        group.get(0) || document.body || document,
                                    );
                                    // 关闭输入框
                                    layer.close(index);
                                },
                            );
                        },
                    );
                } else {
                    input.find("div[id='channelMsg']").text(resp.message);
                }
            },
            /**
             * 缓存通道接口下发的 WebSocket 地址(resp.data.wsUrl), 为空时回退默认地址
             * 供 danMuPop 建连时使用, 避免硬编码地址与服务端配置不一致
             */
            saveWsUrl: function (resp) {
                var wsUrl = resp && resp.data ? resp.data.wsUrl : "";
                this.channelWsUrl = wsUrl ? wsUrl : "https://2120ws.phprm.com";
            },
            channelMemberSuccess: function (resp, input, group, channelCodes, expandDepth) {
                var _this = this;
                var data = resp.data;
                _this.saveWsUrl(resp);
                input.find("div[id='channelMsg']").text("");
                if (data.pushType == 1) {
                    var params = {
                        url: _this.settings.pcUrl,
                        channelName:
                            data.status != 1
                                ? data.channelName + "(未开启)"
                                : data.channelName,
                        uid: data.channelMemberRelId,
                        name: data.nickname,
                        createTime: data.createTime,
                        avatar: data.avatar,
                        group: data.group,
                        channelCode: data.channelCode,
                        token: data.token,
                        shareFlag: data.shareFlag,
                        // 传给 configCallback / kf.init, 由 kf.js 拼到 pc.html/mobile.html 的URL上
                        wsUrl: _this.channelWsUrl || _this.settings.wsUrl
                    };
                    _this.initPusherKF(params);
                    input.find(".lf").text(data.channelName);
                } else if (data.pushType == 10) {
                    // 组合通道: 为每个浏览器子通道各弹一个窗口
                    // 不依赖面板里的 .pusher-button(panel 插件未加载时页面上没有该元素),
                    // 直接按子通道码认领, 认领成功后走 pushType==1 分支自动弹窗
                    var counter = 0;
                    var children = data.childrenChannelMember || [];
                    if (children.length == 0) {
                        console &&
                        console.error(
                            "组合通道码" +
                            data.channelCode +
                            "未绑定浏览器子通道, 无法弹出挂件",
                        );
                    }
                    // 子通道本身还是组合通道时不再自动递归展开, 避免接口异常导致无限认领
                    if (expandDepth > 0) {
                        console &&
                        console.error(
                            "组合通道" +
                            data.channelCode +
                            "的子通道仍是组合通道, 已跳过自动展开",
                        );
                        children = [];
                    }
                    // 无面板时 anchor 退回 body: 认领通道只借它取 ownerDocument
                    var anchor =
                        input && input.length ? input.get(0) : document.body || document;
                    for (var i = 0; i < children.length; i++) {
                        if (children[i]["pushType"] != 1) {
                            continue;
                        }
                        var childCode = children[i]["channelCode"];
                        // 有面板时同步输入框: 第一个填原有输入框, 其余追加输入框;
                        // 未加载 panel 插件时这两步都是空操作
                        if (i == 0) {
                            group
                                .find("input[name='channelCode']")
                                .val(childCode);
                        } else {
                            _this.openPanel("addChannelInput", [
                                input.find("input[name='add']"),
                                childCode,
                            ]);
                        }
                        // 组合码本身不重复认领
                        if (childCode && childCode != channelCodes) {
                            _this.claimChannel(childCode, input, group, anchor, 1);
                        }
                        counter++;
                    }
                    if (counter == 0) {
                        input
                            .find("div[id='channelMsg']")
                            .text("该通道下没有浏览器推送子通道");
                    }
                } else {
                    input
                        .find("div[id='channelMsg']")
                        .text("暂时不支持非浏览器推送方式的通道");
                }
            },
            /**
             * 面板里点"打开推送通道"(或"增加更多通道"后自动触发): 从面板 DOM 取通道码后认领通道
             * @param {Element} button 面板里的按钮(用于定位 .channel-input / .channel-group)
             */
            openPusherDialog: function (button) {
                var input = $(button).parents(".channel-input");
                var group = $(button).parents(".channel-group");
                var channelCodes = group.find("input[name='channelCode']").val();
                return this.claimChannel(channelCodes, input, group, button);
            },
            /**
             * 是否需要建立消息流(Socket.IO 连接):
             *   1) danMu=1: 正常渲染弹幕;
             *   2) danMu=0 但加载了 ad 插件: 广告位靠消息流触发, 仍要收消息, 只是不渲染弹幕。
             */
            needDanMuStream: function () {
                var s = this.settings;
                if (s.danMu == 1) {
                    return true;
                }
                var raw = s.plugins;
                var names = [];
                if (typeof raw == "string") {
                    names = raw.split(",");
                } else if (raw && typeof raw == "object" && typeof raw.length == "number") {
                    names = raw;
                }
                for (var i = 0; i < names.length; i++) {
                    var name = String(names[i] == null ? "" : names[i])
                        .replace(/^\s+|\s+$/g, "")
                        .replace(/\.js$/i, "");
                    if (name === "ad") {
                        return true;
                    }
                }
                return false;
            },
            /**
             * 认领通道(不含 UI): 请求 channelMember 接口, 成功后启动弹幕 / 打开对话框
             * @param {String} channelCodes 通道码
             * @param {jQuery} input 面板里的 .channel-input(无面板时传空集)
             * @param {jQuery} group 面板里的 .channel-group(无面板时传空集)
             * @param {Element|Document} anchor 用来取 ownerDocument / AI弹幕轮询文档
             * @param {Number} [expandDepth] 组合通道自动展开层级: 0/未传=顶层, 子通道传 1
             */
            claimChannel: function (channelCodes, input, group, anchor, expandDepth) {
                var _this = this;
                var s = _this.settings;
                anchor = anchor || document.body || document;

                if (!channelCodes || channelCodes.length == 0) {
                    input.find("div[id='channelMsg']").text("请填写通道码再点击按钮");
                    return false;
                }
                var params;
                if (s.token) {
                    params = {
                        channelCode: channelCodes,
                        uid: s.uid,
                        token: s.token,
                        createTime: s.createTime,
                        avatar: s.avatar
                    };
                } else {
                    // 设备/环境参数直接从 settings 内存对象取, 不再通过 DOM hidden input 中转
                    params = {
                        channelCode: channelCodes,
                        appName: s.appName,
                        clientVersion: s.clientVersion,
                        device: s.device,
                        screenResolution: s.screenResolution,
                        userPlatformType: s.userPlatformType,
                        userPlatformVersion: s.userPlatformVersion,
                        userUa: window.navigator.userAgent.toLowerCase()
                    };
                }
                $.ajax({
                    url: s.channelMemberUrl,
                    dataType: "json",
                    data: params,
                    success: function (resp) {
                        if (resp.code != 0) {
                            _this.channelMemberFail(resp, input, group, channelCodes);
                            return;
                        }
                        // danMuPop 在本函数末尾的 channelMemberSuccess 之前执行, 此处先缓存 wsUrl
                        _this.saveWsUrl(resp);
                        if (_this.needDanMuStream()) {
                            var danMuInit = s.danMuInitCallback(s);
                            // 弹幕开关打开时才建弹幕悬浮图标与 AI 轮询;
                            // danMu=0 只是收消息(如广告位)时不建这些 UI
                            if (s.danMu == 1) {
                                _this.initDanMuIcon();
                                _this.initAiDanMu(anchor);
                            }
                            _this.danMuDoc = anchor.ownerDocument || anchor;
                            if (resp.data.pushType == 1) {
                                _this.danMuSocketToken = resp.data.token;
                                // danMuInitCallback 返回 false 时不创建 socket 连接
                                if (danMuInit) {
                                    _this.danMuPop({ token: resp.data.token });
                                }
                            }
                        }
                        _this.channelMemberSuccess(resp, input, group, channelCodes, expandDepth);
                    },
                });
                return true;
            },
            /**
             * 无面板时的通道认领(panel 插件未加载): 只认领通道 + 按 danMu 开关启动弹幕, 不建任何 UI
             * @param {String} [channelCode] 已知通道码; 未传则按当前网址查(checkUrlChannelCode)
             */
            initChannel: function (channelCode) {
                var _this = this;
                var s = _this.settings;
                var $empty = $();
                var anchor = document.body || document;
                if (channelCode) {
                    s.channelCode = channelCode;
                    return _this.claimChannel(channelCode, $empty, $empty, anchor);
                }
                var headers = _this.getSignHeaders();
                _this.ajaxGet(
                    s.apiUrl,
                    {
                        type: "checkUrlChannelCode",
                        appKey: "pushBookmark",
                        referer: window.location.href,
                        title: document.title,
                        _t: headers["apiTimestamp"],
                    },
                    headers,
                    function (resp) {
                        if (resp.code != 0 || !resp.data || !resp.data["channelCode"]) {
                            return;
                        }
                        s.channelCode = resp.data["channelCode"];
                        _this.claimChannel(s.channelCode, $empty, $empty, anchor);
                    },
                    function () {},
                );
                return true;
            },
            /* ===== 弹幕配置: localStorage 读写 / 缓存 / 保存与重置(表单回填与渲染在 panel 插件) ===== */
            getDanMuConfig: function () {
                var danMuConfig = this.getDanMuStorage();
                var json = {};
                try {
                    json = JSON.parse(danMuConfig);
                } catch (e) {}
                return this.extend(this.extend({}, this.settings.danMuSetting), json);
            },
            initAiDanMu: function (button) {
                var s = this.settings;
                var cfg = this.getDanMuConfig();
                // button 可能是面板 iframe 里的元素, 也可能是宿主 document.body(无面板),
                // ownerDocument 为空时回退到宿主 document
                var doc = button && button.ownerDocument ? button.ownerDocument : document;
                // aiDanMu 统一来源: 开发者传参 / URL参数 / localStorage (getDanMuConfig 已合并; 0=关, N=间隔秒数)
                var aiOn = cfg.aiDanMu > 0;
                if (aiOn) {
                    if (this.danMuTimer) {
                        window.clearTimeout(this.danMuTimer);
                    }
                    s.danMuSetting.aiDanMu = cfg.aiDanMu;
                    s.checkAiDanMu(doc);
                } else {
                    s.danMuSetting.aiDanMu = 0;
                }
                // 弹幕设置表单的回填与切页是面板 UI, 交给 panel 插件; 未加载插件时是空操作
                this.openPanel("initDanMuConfigForm", [doc, cfg, aiOn]);
            },
            parallelLoadScripts: function (scripts, callback) {
                if (typeof scripts != "object") {
                    var scripts = [scripts];
                }
                var HEAD =
                    document.getElementsByTagName("head").item(0) ||
                    document.documentElement,
                    s = new Array(),
                    loaded = 0;
                // 单个脚本无论加载成功还是失败都计入完成次数, 避免其中一个 404 卡住整批回调
                // (加载多个插件时, 一个插件不可用不应导致其它插件也不执行)
                var finish = function (script) {
                    script.onload = script.onreadystatechange = script.onerror = null;
                    if (script.parentNode) {
                        script.parentNode.removeChild(script);
                    }
                    loaded++;
                    if (loaded == scripts.length && typeof callback == "function") {
                        callback();
                    }
                };
                for (var i = 0; i < scripts.length; i++) {
                    s[i] = document.createElement("script");
                    s[i].setAttribute("type", "text/javascript");
                    s[i].onload = s[i].onerror = function () {
                        finish(this);
                    };
                    s[i].onreadystatechange = function () {
                        // IE 用 readyState 判断完成
                        if (
                            navigator.userAgent.indexOf("MSIE") == -1 ||
                            this.readyState == "loaded" ||
                            this.readyState == "complete"
                        ) {
                            finish(this);
                        }
                    };
                    s[i].setAttribute("src", scripts[i]);
                    // 动态脚本统一声明 UTF-8, 避免 GBK 宿主页面把插件/依赖中的中文读成乱码
                    s[i].setAttribute("charset", "UTF-8");
                    HEAD.appendChild(s[i]);
                }
            },
            /* ======================= 插件目录 =======================
             * 插件放在 settings.pluginsSite 目录下, 文件名 = 插件名 + ".js";
             * settings.plugins 指定要加载的插件名(英文逗号分隔, 可多个), 加载方式:
             *   1) loadPlugins 动态注入 pluginsSite/name.js
             *   2) 插件脚本加载时调用 WebsitePusher.registerPlugin(name, run) 注册
             *   3) 脚本 onload 后由 loadPlugins 执行 run(settings)
             * 插件内部可读写 WebsitePusher.settings, 也可调用组件对外方法。
             */
            registerPlugin: function (name, run) {
                if (!name || typeof run != "function") {
                    return;
                }
                this.pluginsRegistry[String(name)] = run;
            },
            /**
             * 按 settings.plugins(英文逗号分隔, 可多个) 动态加载插件目录中的 name.js,
             * 全部加载完成后执行已注册插件; 同一插件名在本实例内只加载一次
             */
            loadPlugins: function () {
                var _this = this;
                var s = _this.settings;
                var raw = s.plugins;
                var names = [];
                // plugins 支持字符串(英文逗号分隔)或数组
                if (typeof raw == "string") {
                    names = raw.split(",");
                } else if (raw && typeof raw == "object" && typeof raw.length == "number") {
                    names = raw;
                }
                var base = s.pluginsSite || s.jsSite + "/plugins/";
                var urls = [];
                var pending = [];
                for (var i = 0; i < names.length; i++) {
                    // 去两侧空白, 兼容误写成文件名的情况(stat.js => stat);
                    // 只接受字母/数字/下划线/中划线, 防止拼出非法或有穿越风险的路径
                    var name = String(names[i] == null ? "" : names[i])
                        .replace(/^\s+|\s+$/g, "")
                        .replace(/\.js$/i, "");
                    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
                        continue;
                    }
                    if (_this.loadedPlugins[name]) {
                        continue;
                    }
                    _this.loadedPlugins[name] = true;
                    urls.push(base + name + ".js");
                    pending.push(name);
                }
                if (!urls.length) {
                    return;
                }
                // 标记插件未就绪: init 的建 UI 阶段要等插件(尤其 panel 面板)注册完再执行,
                // 否则 plugins=panel 时 initPusherWindow 读到的 this.panel 还是 null, 面板不会弹出
                _this.pluginsLoading++;
                _this.parallelLoadScripts(urls, function () {
                    for (var j = 0; j < pending.length; j++) {
                        var run = _this.pluginsRegistry[pending[j]];
                        if (typeof run != "function") {
                            if (typeof console != "undefined" && console.log) {
                                console.log("插件未注册: " + pending[j]);
                            }
                            continue;
                        }
                        // 插件异常不影响组件主流程
                        try {
                            run(s);
                        } catch (e) {
                            if (typeof console != "undefined" && console.log) {
                                console.log(e);
                            }
                        }
                    }
                    _this.pluginsLoading--;
                    _this.flushPluginsCallbacks();
                });
            },
            /**
             * 等插件脚本全部加载并执行完后再回调; 没有插件或插件已就绪时立即回调
             * 用于 init 的建 UI 阶段(依赖插件注册结果, 如 panel 插件注册的右上角面板)
             */
            afterPluginsLoaded: function (callback) {
                if (typeof callback != "function") {
                    return;
                }
                if (this.pluginsLoading > 0) {
                    if (!this.pluginsCallbacks) {
                        this.pluginsCallbacks = [];
                    }
                    this.pluginsCallbacks.push(callback);
                    return;
                }
                callback();
            },
            flushPluginsCallbacks: function () {
                // 还有别的批次在加载: 等最后一批完成时统一回调
                if (this.pluginsLoading > 0) {
                    return;
                }
                var callbacks = this.pluginsCallbacks;
                this.pluginsCallbacks = null;
                if (!callbacks) {
                    return;
                }
                for (var i = 0; i < callbacks.length; i++) {
                    // 单个回调异常不影响其它回调与主流程
                    try {
                        callbacks[i]();
                    } catch (e) {
                        if (typeof console != "undefined" && console.log) {
                            console.log(e);
                        }
                    }
                }
            },
            initPusherKF: function (params) {
                var s = this.settings;
                // 将当前成员的个人信息缓存到 settings, 供 sendCallback 等调用方搜集用户上下文
                if (params) {
                    if ("channelName" in params) s.channelName = params.channelName;
                    if ("uid" in params) s.uid = params.uid;
                    if ("name" in params) s.name = params.name;
                    if ("createTime" in params) s.createTime = params.createTime;
                    if ("avatar" in params) s.avatar = params.avatar;
                    if ("channelCode" in params) s.channelCode = params.channelCode;
                    if ("token" in params) s.token = params.token;
                    if ("group" in params) s.group = params.group;
                    if ("shareFlag" in params) s.shareFlag = params.shareFlag;
                }
                // 保证 configCallback 与 kf.init 收到的 params 一定带 wsUrl(外部直接调用 initPusherKF 时兜底)
                if (params && !params.wsUrl) {
                    params.wsUrl = this.channelWsUrl || s.wsUrl;
                }
                if (!s.configCallback) {
                    return;
                }
                var allow = s.configCallback(params);
                if (!allow || s.hideDialog) {
                    return;
                }
                if (typeof KF === "undefined") {
                    this.parallelLoadScripts(
                        [s.jsSite + "/kf.js", s.jsSite + "/layer/layer.js"],
                        function () {
                            var kf = new KF();
                            kf.init(params);
                        },
                    );
                } else {
                    var kf = new KF();
                    kf.init(params);
                }
            },
            /* ===== 弹幕核心：Socket.IO 单例连接 / 消息分发 ===== */
            danMuPop: function (params) {
                var _this = this;
                var sock = _this.danMuSocket;
                if (sock) {
                    // 同一个 token（同一通道/用户）→ 复用已有连接，直接返回
                    if (_this.danMuSocketToken === params.token) {
                        return;
                    }
                    // token 变化 → 先断开旧连接再建新的
                    try {
                        sock.removeAllListeners();
                        sock.disconnect();
                    } catch (e) {}
                    _this.danMuSocket = null;
                    _this.danMuSocketToken = null;
                }
                var so = io(
                    _this.settings.wsUrl ||
                        _this.channelWsUrl ||
                        "https://2120ws.phprm.com",
                );
                _this.danMuSocket = so;
                _this.danMuSocketToken = params.token;
                // 读取弹幕配置并缓存（避免每条消息重复读取解析）
                var cfg = _this.getDanMuConfig();
                _this.updateCfgCache(cfg);
                so.on("connect", function () {
                    so.emit("danMuLogin", params.token);
                });
                so.on("new_dm", function (msg) {
                    if ("undefined" != typeof console) {
                        console.log("收到弹幕消息：" + msg);
                    }
                    if (msg == null || msg.indexOf("{") != 0) {
                        return;
                    }
                    var cache = _this.cfgCache || {
                        cfg: {},
                        bottomradio: 0,
                        textLen: 40,
                    };
                    var cfg = cache.cfg;
                    var bottomradio = cache.bottomradio;
                    var textLen = cache.textLen;
                    try {
                        var message = JSON.parse(msg);
                        // 原始消息闸门: 插件/宿主可自行处理某类消息(如 head=广告 走广告位),
                        // 返回 true 表示已处理, 组件不再把这条消息渲染成弹幕
                        var msgHook = _this.settings.danMuMessageCallback;
                        if (typeof msgHook == "function") {
                            var handled = false;
                            try {
                                handled = msgHook.call(_this.settings, message);
                            } catch (e) {
                                console && console.log("danMuMessageCallback 执行异常: " + e);
                            }
                            if (handled === true) {
                                return;
                            }
                        }
                        // danMu=0(只收消息, 如广告位): 未处理的普通消息不渲染弹幕
                        if (_this.settings.danMu != 1) {
                            return;
                        }
                        var title = _this.cutText(message.head, Math.ceil(textLen));
                        _this.buildBarragerItem(
                            message.messageId
                                ? message.messageId
                                : message.messagePushId,
                            message.avatar,
                            title,
                            message.url,
                            cfg,
                            bottomradio
                        );
                    } catch (e) {
                        console && console.log("弹幕消息解析失败: " + e);
                    }
                });
            },
            buildBarragerItem: function (id, img, info, href, cfg, bottomradio) {
                var s = this.settings;
                var item = {
                    id: id,
                    img: img,
                    info: info,
                    like: cfg.like == 0 ? 0 : 1,
                    close: cfg.close == 0 ? 0 : 1,
                    closeText: s.closeText,
                    speed: cfg.speed ? cfg.speed : 16,
                    bottom: cfg.bottom && bottomradio ? cfg.bottom : 0,
                    size: cfg.size ? cfg.size : 20,
                    opacity: cfg.opacity ? cfg.opacity : 0,
                    color: cfg.color ? cfg.color : "#fff",
                    old_ie_color: "#000000",
                };
                if (href) {
                    item.href = href;
                }
                if (s.messageIdList && s.messageIdList.indexOf(id) !== -1) {
                    s.danMuFilterCallback(item, function (dom) {
                        s.danMuPopCallback(dom, item);
                        if (s.messageIdList.length > s.messageLength) {
                            s.messageIdList.splice(
                                0,
                                s.messageIdList.length - s.messageLength,
                            );
                        }
                    });
                    return;
                }
                s.danMuFilter(item);
            },
            updateCfgCache: function (cfg) {
                var bottomradio = cfg.bottomradio ? cfg.bottomradio : 0;
                var textLen = 40;
                if (cfg.size) {
                    var min = cfg.size - 10;
                    textLen =
                        textLen - (min > 0 ? min : 0) < 10
                            ? 10
                            : textLen - (min > 0 ? min : 0);
                }
                this.cfgCache = {
                    cfg: cfg,
                    bottomradio: bottomradio,
                    textLen: textLen,
                };
            },
            pad2: function (n) {
                return n < 10 ? "0" + n : "" + n;
            },
            pickSortedIndices: function (total, pick) {
                var arr = [];
                for (var i = 0; i < total; i++) arr.push(i);
                for (var j = arr.length - 1; j > 0; j--) {
                    var r = Math.floor(Math.random() * (j + 1));
                    var tmp = arr[j];
                    arr[j] = arr[r];
                    arr[r] = tmp;
                }
                return arr.slice(0, pick).sort(function (a, b) {
                    return a - b;
                });
            },
            splitLinesIntoGroups: function (lines, c) {
                var groups = [];
                var n = lines.length;
                if (n === 0) {
                    while (c--) groups.push("");
                    return groups;
                }
                // 分组数不超过实际行数，防止 step=0 导致所有行被塞进最后一组
                if (c > n) c = n;
                var step = Math.floor(n / c);
                var pos = 0;
                for (var k = 0; k < c; k++) {
                    var end = k === c - 1 ? n : pos + step;
                    groups.push(lines.slice(pos, end).join("\n"));
                    pos = end;
                }
                return groups;
            },
            joinPickedGroups: function (groups, pickedIdx) {
                var parts = [];
                for (var i = 0; i < pickedIdx.length; i++) {
                    parts.push(groups[pickedIdx[i]]);
                }
                return parts.join("\n");
            },
            buildAiDanMuBody: function () {
                var bodyText = document.body.innerText || "";
                var lines = bodyText.split(/\r?\n|\r/);
                var body = "";
                var cfg = [
                    { min: 0, max: 10, groups: 0, pick: 0, isTime: true },
                    { min: 10, max: 50, groups: 8, pick: 6 },
                    { min: 50, max: 100, groups: 10, pick: 5 },
                    { min: 100, max: 200, groups: 15, pick: 7 },
                    { min: 200, max: Infinity, groups: 20, pick: 5 },
                ];
                var len = lines.length;
                for (var i = 0; i < cfg.length; i++) {
                    if (len >= cfg[i].min && len < cfg[i].max) {
                        if (cfg[i].isTime) {
                            var d = new Date();
                            var timeStr =
                                "当前时间: " +
                                d.getFullYear() +
                                "/" +
                                this.pad2(d.getMonth() + 1) +
                                "/" +
                                this.pad2(d.getDate()) +
                                " " +
                                this.pad2(d.getHours()) +
                                ":" +
                                this.pad2(d.getMinutes()) +
                                ":" +
                                this.pad2(d.getSeconds());
                            body = bodyText + timeStr;
                        } else {
                            var groups = this.splitLinesIntoGroups(lines, cfg[i].groups);
                            var picked = this.pickSortedIndices(cfg[i].groups, cfg[i].pick);
                            body = this.joinPickedGroups(groups, picked);
                        }
                        break;
                    }
                }
                if (body.length > 2000) {
                    body = this.cutText(body, 2000, "");
                }
                return body;
            },
            cutText: function (str, maxLen, ellipsis) {
                if (maxLen == null) {
                    maxLen = 30;
                }
                if (ellipsis == null) {
                    ellipsis = "...";
                }
                if (!str) {
                    return "";
                }
                var chars = String(str).split("");
                if (chars.length <= maxLen) {
                    return str;
                }
                return chars.slice(0, maxLen).join("") + ellipsis;
            },
            /**
             * 拼接WebSocket地址参数(供下面两个 URL 方法复用)
             * 为空时不拼该参数, 聊天页(pc.html/mobile.html)会自动回退内置地址
             */
            appendWsUrlParam: function (url, c) {
                return c && c.wsUrl
                    ? url + "&wsUrl=" + encodeURIComponent(c.wsUrl)
                    : url;
            },
            getPusherPcUrl: function (c) {
                return WebsitePusher.appendWsUrlParam(
                    c.url +
                        "?group=" +
                        c.group +
                        "&token=" +
                        c.token +
                        "&createTime=" +
                        c.createTime +
                        "&channelCode=" +
                        c.channelCode +
                        "&shareFlag=" +
                        c.shareFlag +
                        "&channelName=" +
                        c.channelName +
                        "&uid=" +
                        c.uid +
                        "&name=" +
                        c.name +
                        "&avatar=" +
                        encodeURIComponent(c.avatar),
                    c,
                );
            },
            getPusherMobileUrl: function (c) {
                return WebsitePusher.appendWsUrlParam(
                    c.url.replace("pc", "mobile") +
                        "?group=" +
                        c.group +
                        "&token=" +
                        c.token +
                        "&createTime=" +
                        c.createTime +
                        "&channelCode=" +
                        c.channelCode +
                        "&shareFlag=" +
                        c.shareFlag +
                        "&channelName=" +
                        c.channelName +
                        "&uid=" +
                        c.uid +
                        "&name=" +
                        c.name +
                        "&avatar=" +
                        encodeURIComponent(c.avatar),
                    c,
                );
            },
            closePusher: function (skipResetInited) {
                // 单例标志复位: 用户主动关闭后允许再次 init; 内部清理调用时跳过复位
                if (!skipResetInited) {
                    this._initedAppName = null;
                }
                // 1) 先停 AI 弹幕轮询定时器，防止关闭后回调访问已销毁的 iframe/doc
                if (this.danMuTimer) {
                    window.clearTimeout(this.danMuTimer);
                    this.danMuTimer = null;
                }
                // 2) 断开弹幕 Socket.IO 连接，清理监听器与令牌
                if (this.danMuSocket) {
                    try {
                        this.danMuSocket.removeAllListeners();
                        this.danMuSocket.disconnect();
                    } catch (e) {}
                    this.danMuSocket = null;
                    this.danMuSocketToken = null;
                }
                // 3) 最后移除 DOM（避免清理过程中资源事件继续投递到已删除节点）
                $("#pushWebAnonymous").remove();
                // 4) 移除弹幕悬浮图标
                $("#pushWebDanIcon").remove();
                // 5) 清除页面上所有滚动的弹幕
                $(".barrage").remove();
                // 6) 清空弹幕去重缓存(缓存挂在 settings 上, 因 danMuFilterCallback 内 this===settings),
                //    避免下次初始化时旧id误判为重复
                this.settings.danMuSeenIds = null;
                this.settings.danMuSeenCount = 0;
                // 7) 清除 startDanMu 所需的重启上下文(token/doc), 防止面板销毁后误用
                this.danMuDoc = null;
                // 8) 清除显隐/暂停/区域 API 注入的样式和容器
                $("#pushWebDanMuHideStyle").remove();
                $("#pushWebDanMuAreaStyle").remove();
                $("#pushWebDanMuArea").remove();
                this.settings.danMuPaused = false;
                this.settings.danMuQueue = null;
                this.settings.danMuSetting.selector = "body";
            },
            /**
             * 停止弹幕: 断开 Socket.IO、停止 AI 弹幕轮询、清除屏幕弹幕。
             * 保留 danMuSocketToken 和 danMuDoc 供 startDanMu 恢复, 不影响面板和图标。
             * 适用场景: 开发者在页面上放置弹幕开关, 关闭时调用。
             */
            stopDanMu: function () {
                var _this = this;
                // 1) 停止 AI 弹幕轮询定时器
                if (_this.danMuTimer) {
                    window.clearTimeout(_this.danMuTimer);
                    _this.danMuTimer = null;
                }
                // 2) 断开 Socket.IO 连接, 清理监听器(保留 danMuSocketToken 供恢复)
                if (_this.danMuSocket) {
                    try {
                        _this.danMuSocket.removeAllListeners();
                        _this.danMuSocket.disconnect();
                    } catch (e) {}
                    _this.danMuSocket = null;
                }
                // 3) 清除屏幕上所有滚动弹幕
                $(".barrage").remove();
                return true;
            },
            /**
             * 启动弹幕: 恢复 Socket.IO 监听、重启 AI 弹幕轮询。
             * 依赖 stopDanMu 之前保存的 danMuSocketToken 和 danMuDoc。
             * 适用场景: 开发者在页面上放置弹幕开关, 开启时调用。
             */
            startDanMu: function () {
                var _this = this;
                var s = _this.settings;
                // 未初始化或面板已关闭(token 被清空)→ 无法启动
                if (!_this.danMuSocketToken) {
                    return false;
                }
                // 1) 重连 Socket.IO (danMuPop 内部处理: 无连接时新建, 已连接同 token 复用)
                _this.danMuPop({ token: _this.danMuSocketToken });
                // 2) 重启 AI 弹幕轮询 (checkAiDanMu 内部判断 aiDanMu>0 才轮询)
                if (s.danMu == 1 && s.danMuSetting.aiDanMu > 0 && _this.danMuDoc) {
                    s.checkAiDanMu(_this.danMuDoc, 1);
                }
                return true;
            },
            /**
             * 更新弹幕配置并立即生效。
             * 传入 danMuSetting 的部分字段, 自动合并到 settings.danMuSetting、localStorage、cfgCache,
             * 使新配置对后续弹幕立即生效; aiDanMu 变化时自动启停 AI 轮询。
             * @param {object} options - danMuSetting 字段子集, 如 {opacity:80, aiDanMu:10}
             */
            updateDanMu: function (options) {
                var _this = this;
                var s = _this.settings;
                options = options || {};
                // 记录变更前的 aiDanMu, 用于判断是否需要重启轮询
                var prevAi = parseInt(s.danMuSetting.aiDanMu) || 0;
                // 1) 深合并到 settings.danMuSetting
                _this.extend(s.danMuSetting, options);
                // 归一化 aiDanMu 为数字
                var newAi = parseInt(s.danMuSetting.aiDanMu) || 0;
                s.danMuSetting.aiDanMu = newAi;
                // 2) 同步到 localStorage, 否则 getDanMuConfig 的 localStorage 旧值会覆盖 danMuSetting
                var stored = {};
                try {
                    stored = JSON.parse(_this.getDanMuStorage()) || {};
                } catch (e) {}
                _this.extend(stored, options);
                // localStorage 同样归一化 aiDanMu
                stored.aiDanMu = newAi;
                _this.setDanMuStorage(JSON.stringify(stored));
                // 3) 重建 cfgCache, 使外观配置(opacity/size/speed/color/bottom 等)立即对后续弹幕生效
                var cfg = _this.getDanMuConfig();
                _this.updateCfgCache(cfg);
                // 4) aiDanMu 变化时启动或停止 AI 轮询
                if (newAi > 0) {
                    // 间隔变化或之前未在轮询 → 启动; 未变且正在轮询 → 不重启(保留 pollCount)
                    if (newAi !== prevAi || !_this.danMuTimer) {
                        if (_this.danMuDoc) {
                            s.checkAiDanMu(_this.danMuDoc, 1);
                        }
                    }
                } else {
                    // aiDanMu=0 → 停止轮询
                    if (_this.danMuTimer) {
                        window.clearTimeout(_this.danMuTimer);
                        _this.danMuTimer = null;
                    }
                }
            },
            /**
             * 隐藏弹幕: 所有 .barrage 元素变为不可见, 但动画继续运行(不丢消息)。
             * 用 visibility:hidden 而非 display:none, 避免 jQuery .animate() 位置计算异常。
             */
            hideDanMu: function () {
                if (!$("#pushWebDanMuHideStyle").length) {
                    var style = document.createElement("style");
                    style.id = "pushWebDanMuHideStyle";
                    style.innerHTML = ".barrage{visibility:hidden !important;}";
                    document.head.appendChild(style);
                }
            },
            /**
             * 显示弹幕: 移除 hideDanMu 注入的 CSS, 弹幕恢复可见。
             */
            showDanMu: function () {
                $("#pushWebDanMuHideStyle").remove();
            },
            /**
             * 清屏: 移除当前所有弹幕元素(含可见区域外和暂停队列),
             * 不影响 Socket.IO 连接、AI 轮询、面板和图标。
             */
            clearDanMu: function () {
                // 1) 移除 DOM 上所有弹幕(无论挂在 body 还是 #pushWebDanMuArea 容器内)
                $(".barrage").remove();
                // 2) 清空暂停期间暂存的消息队列, 避免恢复后重新弹出已清除的内容
                this.settings.danMuQueue = null;
            },
            /**
             * 主动发送弹幕(这里仅发送到当前屏幕)，如需审核存储后再推送, 请在sendCallback回调中异步请求业务方后端, 再由后端进行推送给其他人。
             * 复用 danMuFilter → danMuFilterCallback 链路, 自动应用去重、info空白校验、暂停队列、配置合并。
             * 渲染完成后(或因去重/空白被拦截后)调用 sendCallback(item, settings) 回传。
             * @param {object} rawItem  弹幕内容, 支持字段: info(必填,文本) / id(可选,缺省自动生成) /
             *                          img(头像) / href(跳转链接) / like / close / closeText /
             *                          speed / bottom / size / opacity / color / num(点赞数)
             * @returns {boolean}  true=进入渲染链路, false=info为空或被去重拦截
             */
            sendDanMu: function (rawItem) {
                var _this = this;
                var s = _this.settings;
                var dms = s.danMuSetting;
                rawItem = rawItem || {};
                // 生成局部 id: 用 "local_" + 时间戳 + 随机数, 避免与推送来的真实 messageId 冲突
                var item = {
                    id:
                        rawItem.id != null && String(rawItem.id) !== ""
                            ? rawItem.id
                            : "local_" +
                            Date.now() +
                            "_" +
                            Math.floor(Math.random() * 10000),
                    info: rawItem.info != null ? rawItem.info : "",
                    img: rawItem.img || "",
                    href: rawItem.href || "",
                    like: typeof rawItem.like !== "undefined" ? (rawItem.like == 0 ? 0 : 1) : (dms.like == 0 ? 0 : 1),
                    close: typeof rawItem.close !== "undefined" ? (rawItem.close == 0 ? 0 : 1) : (dms.close == 0 ? 0 : 1),
                    closeText: rawItem.closeText || s.closeText,
                    speed: rawItem.speed || dms.speed || 16,
                    bottom: rawItem.bottom || (dms.bottomradio ? (dms.bottom || 0) : 0),
                    size: rawItem.size || dms.size || 20,
                    opacity: typeof rawItem.opacity !== "undefined" ? rawItem.opacity : dms.opacity || 0,
                    color: rawItem.color || dms.color || "#fff",
                    old_ie_color: rawItem.old_ie_color || "#000000",
                    num: parseInt(rawItem.num) || 0
                };
                // 渲染是否真正执行(没被去重/空白拦住)
                var rendered = false;
                try {
                    // 直接调用 danMuFilterCallback(跳过 danMuFilter 的 num=0 覆盖), this===settings 正确
                    // 去重/info空白/暂停队列全部在 danMuFilterCallback 内处理
                    s.danMuFilterCallback.call(s, item, function (dom) {
                        s.danMuPopCallback(dom, item);
                        rendered = true;
                    });
                } catch (e) {
                    rendered = false;
                }
                // 无论是否成功渲染, 都调用 settings.sendCallback(item, settings) 回传
                // 第二个参数 settings 含 channelName/uid/name/createTime/avatar/channelCode/token/group/shareFlag/
                // device/screenResolution/userPlatformType/userPlatformVersion 等用户上下文
                if (s.sendCallback && typeof s.sendCallback === "function") {
                    s.sendCallback(item, s);
                }
                return rendered;
            },
            /**
             * 暂停弹幕: 停止所有 .barrage 的 jQuery 动画(冻结在当前位置),
             * 新到达的消息暂存到队列, resumeDanMu 时统一渲染。
             */
            pauseDanMu: function () {
                var s = this.settings;
                $(".barrage").stop(true);
                s.danMuPaused = true;
            },
            /**
             * 恢复弹幕: 重启冻结的 .barrage 动画 + 刷新暂停期间暂存的消息队列。
             */
            resumeDanMu: function () {
                var _this = this;
                var s = _this.settings;
                s.danMuPaused = false;
                // 1) 重启冻结的弹幕动画 (barrager.js 用 jQuery .animate, .stop(true) 后需手动恢复)
                var speed = (s.danMuSetting.speed ? s.danMuSetting.speed : 16) * 1000;
                var targetRight = $(window).width() + 500;
                // 与 barrager.js 保持一致: 起点为 -(弹幕自身宽度+20), 不再是固定的 -500
                // (起点若按 -500 估算, totalDist 偏小, 恢复飞行时剩余时长会算多, 弹幕明显变慢)
                $(".barrage").each(function () {
                    var $el = $(this);
                    var elWidth = $el.outerWidth(true) || 0;
                    var totalDist = targetRight + elWidth + 20;
                    var curRight = parseInt($el.css("right"));
                    if (isNaN(curRight)) {
                        curRight = -(elWidth + 20);
                    }
                    if (curRight < targetRight) {
                        var remain = targetRight - curRight;
                        var dur = Math.max(1000, (remain / totalDist) * speed);
                        $el.animate({ right: targetRight }, dur, "linear", function () {
                            $(this).remove();
                        });
                    } else {
                        $el.remove();
                    }
                });
                // 2) 刷新暂停期间暂存的消息队列
                if (s.danMuQueue && s.danMuQueue.length) {
                    var queue = s.danMuQueue;
                    s.danMuQueue = [];
                    for (var i = 0; i < queue.length; i++) {
                        var entry = queue[i];
                        entry.callback(entry.dom, entry.item);
                        $(entry.dom).barrager(entry.item);
                    }
                }
            },
            /**
             * 设置弹幕显示区域比例。
             * 创建一个 fixed 定位、overflow:hidden 的容器作为弹幕挂载节点,
             * 并将 .barrage 从 position:fixed 改为 position:absolute 使其受容器裁剪。
             * @param {number} ratio  0.1~1, 如 0.5=只在上半屏显示弹幕; 1=全屏(恢复默认)
             */
            setDanMuArea: function (ratio) {
                var _this = this;
                var s = _this.settings;
                ratio = Math.max(0.1, Math.min(1, parseFloat(ratio) || 1));
                var height = Math.round($(window).height() * ratio);
                var $container = $("#pushWebDanMuArea");
                if (!$container.length) {
                    $container = $("<div id='pushWebDanMuArea'></div>")
                        .css({
                            position: "fixed",
                            top: "0",
                            left: "0",
                            width: "100%",
                            overflow: "hidden",
                            "pointer-events": "none",
                            "z-index": "99998",
                        })
                        .appendTo("body");
                    // 容器内 .barrage 改为 absolute, 使其受 overflow:hidden 裁剪
                    $(
                        "<style id='pushWebDanMuAreaStyle'>#pushWebDanMuArea .barrage{position:absolute !important;pointer-events:auto !important;}</style>",
                    ).appendTo("head");
                    s.danMuSetting.selector = "#pushWebDanMuArea";
                }
                $container.css("height", height + "px");
                // ratio=1 时恢复默认 body 挂载
                if (ratio >= 1) {
                    s.danMuSetting.selector = "body";
                }
            },
            initDanMuIcon: function () {
                var _this = this;
                // hideIcon=1时不创建右下角浮窗图标, 但不影响弹幕推送、面板等其他功能
                if (_this.settings.danMuSetting.hideIcon == 1) {
                    return;
                }
                if ($("#pushWebDanIcon").length) {
                    return;
                }
                var icon = document.createElement("div");
                icon.id = "pushWebDanIcon";
                // 外层透明容器扩大 hover 区域，覆盖 dan.png(37x25) 和 4.gif(右上角外延20px)
                // bottom:20 width:57 height:45 保持 dan.png 和 4.gif 视觉位置与之前一致
                // 定位用 left:100% + margin-left:-55px 而非 right:-2px:
                //   移动端窄屏下宿主页面(宽表格/宽代码块)会把文档撑出水平溢出, 部分 webview(微信/QQ等)
                //   对 position:fixed 元素的 right 定位会参照溢出文档右边缘而非视觉视口, 导致图标被甩到
                //   文档右下角(需滚动才可见); left 定位始终相对视觉视口(与左下角正常悬浮的图标同族),
                //   left:100% 即容器左边缘对齐视口右边缘, 再左移55px(露出55px, 右边缘超出2px),
                //   视觉与原 right:-2px 完全等价, 且桌面/移动端表现一致。
                icon.style.cssText =
                    "position:fixed; left:100%; margin-left:-55px; bottom:20px; z-index:2147483647; width:57px; height:45px; cursor:pointer;";
                // dan.png 背景放在内层 div，定位在容器右下角；4.gif 在容器右上角
                icon.innerHTML =
                    '<div class="dan-icon-img" style="position:absolute; right:20px; top:20px; width:37px; height:25px; background:url(' +
                    _this.settings.cssSite +
                    'images/dan.png) no-repeat 0 0;"></div>' +
                    '<img src="' +
                    _this.settings.cssSite +
                    'images/4.gif" style="position:absolute; right:0; top:0; cursor:pointer; display:none;" class="dan-close-btn" />';
                document.body.appendChild(icon);
                // hover 绑在外层，鼠标在 dan.png 或 4.gif 上都触发橙色+显示关闭按钮
                $(icon).hover(
                    function () {
                        $(this).find(".dan-icon-img").css("background-position", "0 100%");
                        $(this).find(".dan-close-btn").show();
                    },
                    function () {
                        $(this).find(".dan-icon-img").css("background-position", "0 0");
                        $(this).find(".dan-close-btn").hide();
                    },
                );
                $(icon)
                    .find(".dan-close-btn")
                    .click(function (e) {
                        e.stopPropagation();
                        $(icon).hide();
                        return false;
                    });
                $(icon).click(function (e) {
                    if ($(e.target).hasClass("dan-close-btn")) return;
                    var s = _this.settings;
                    if (s.danMuSendOpened) {
                        s.danMuSendOpened = false;
                        if (typeof s.danMuSendClose === "function") {
                            s.danMuSendClose(s);
                        }
                    } else {
                        s.danMuSendOpened = true;
                        if (typeof s.danMuSendOpen === "function") {
                            s.danMuSendOpen(s);
                        }
                    }
                });
                // 控制面板初始化完毕后闪烁3次吸引注意：灰色→橙色→灰色，每次1秒
                var $flashImg = $(icon).find(".dan-icon-img");
                var flashCount = 0;
                var flashMax = 3;
                var flashStep = function () {
                    if (flashCount >= flashMax) {
                        $flashImg.css("background-position", "0 0");
                        return;
                    }
                    flashCount++;
                    $flashImg.css("background-position", "0 100%");
                    setTimeout(function () {
                        $flashImg.css("background-position", "0 0");
                        setTimeout(flashStep, 500);
                    }, 500);
                };
                setTimeout(flashStep, 500);
            },
            /**
             * 右下角弹幕图标点击: 面板吸边/恢复或显示/隐藏(具体实现由 panel 插件提供)
             */
            togglePusherPanel: function () {
                return this.openPanel("toggle");
            },
            /* GET + JSON + withCredentials 的公共请求 */
            ajaxGet: function (url, data, headers, onSuccess, onError, extra) {
                var opt = {
                    url: url,
                    type: "GET",
                    data: data,
                    headers: headers,
                    dataType: "json",
                    xhrFields: { withCredentials: true },
                    crossDomain: true,
                    success: onSuccess,
                    error: onError
                };
                if (extra) {
                    for (var k in extra) opt[k] = extra[k];
                }
                $.ajax(opt);
            },
            /**
             * 触发一条推送（插件/宿主上报共用）：
             * POST settings.triggerUrl + channelCode，请求体为 JSON：{ head, url: 当前网址, body: 可选内容 }
             * 用 POST + application/json 而不是 GET 拼查询串：正文可以带到 5 万字符，
             * 也不受浏览器/网关的 URL 长度限制（服务端已放开这条接口的 CORS 预检）
             * 通道码未认领时先等它就绪(最多10秒)，等不到则放弃并回调 false
             * @param {String} head 记录类型，如 "visit" / "click" / "axios" / "vue"
             * @param {String} [body] 内容，超过 5 万字符会被截断
             * @param {Function} [callback] 完成回调，入参为是否成功
             */
            pushTrigger: function (head, body, callback) {
                var _this = this;
                // 服务端接收 application/json 的正文上限，超出会整条请求被丢弃，这里先截断兜底
                var MAX_BODY_LENGTH = 50000;
                if (!head) {
                    if (callback) callback(false);
                    return;
                }
                var send = function () {
                    var s = _this.settings;
                    var base = s.triggerUrl || "";
                    if (!s.channelCode || !base) {
                        if (callback) callback(false);
                        return;
                    }
                    if (base.charAt(base.length - 1) != "/") {
                        base += "/";
                    }
                    var payload = {
                        head: head,
                        url: window.location.href
                    };
                    if (body != null && body !== "") {
                        var text = String(body);
                        payload.body = text.length > MAX_BODY_LENGTH
                            ? text.substring(0, MAX_BODY_LENGTH)
                            : text;
                    }
                    // 触发接口不鉴权: 普通跨域 POST(不携带凭据), 不带 withCredentials,
                    // 避免要求服务端额外放开凭据跨域(与旧的 GET 行为保持一致)
                    $.ajax({
                        url: base + encodeURIComponent(s.channelCode),
                        type: "POST",
                        contentType: "application/json; charset=utf-8",
                        dataType: "json",
                        crossDomain: true,
                        processData: false,
                        data: JSON.stringify(payload),
                        success: function () {
                            if (callback) callback(true);
                        },
                        error: function () {
                            if (callback) callback(false);
                        }
                    });
                };
                _this.waitChannelCode(send, function () {
                    if (callback) callback(false);
                });
            },
            /**
             * 等通道码就绪：已被认领则立即回调，超时(默认10秒)则走 onTimeout
             * 通道码可能由组件按当前网址异步认领，插件在 init 阶段读到的通常是空值
             */
            waitChannelCode: function (onReady, onTimeout) {
                var _this = this;
                var waited = 0;
                var tick = function () {
                    if (_this.settings.channelCode) {
                        onReady();
                        return;
                    }
                    waited += 200;
                    if (waited >= 10000) {
                        if (onTimeout) onTimeout();
                        return;
                    }
                    window.setTimeout(tick, 200);
                };
                tick();
            },
            /* ===== 工具方法：签名 / Cookie / URL / 文本 / 脚本加载 ===== */
            getSignHeaders: function () {
                var apiTimestamp = new Date().getTime();
                var apiNonce = hex_md5(Math.random());
                var rawText =
                    apiTimestamp + "#" + this.settings.apiKey + "#" + apiNonce;
                var apiSign = hex_md5(rawText);
                return {
                    apiTimestamp: apiTimestamp,
                    apiNonce: apiNonce,
                    apiSign: apiSign
                };
            },
            getUserInfo: function (name) {
                return this.cookieGet(name);
            },
            storeUserInfo: function (name, value, chkRemember) {
                // cookieSet 第三参为天: -1=立即过期(删除), 勾选记住=30天, 否则2小时(2/24)
                if (chkRemember == -1) {
                    this.cookieSet(name, value, -1);
                } else if (chkRemember == true) {
                    this.cookieSet(name, value, 30);
                } else {
                    this.cookieSet(name, value, 2 / 24);
                }
            },
            /* 弹幕配置持久化: 优先 localStorage; 不可用时回退 cookie */
            getDanMuStorage: function () {
                try {
                    if (window.localStorage) {
                        return window.localStorage.getItem(this.DK) || "";
                    }
                } catch (e) {}
                return this.cookieGet(this.DK);
            },
            setDanMuStorage: function (value) {
                var ok = false;
                try {
                    if (window.localStorage) {
                        window.localStorage.setItem(this.DK, value);
                        ok = true;
                    }
                } catch (e) {}
                if (!ok) {
                    this.cookieSet(this.DK, value, 365);
                }
            },
            removeDanMuStorage: function () {
                try {
                    if (window.localStorage) {
                        window.localStorage.removeItem(this.DK);
                    }
                } catch (e) {}
                this.cookieSet(this.DK, "", -1);
            },
            /* 设备ID持久化: localStorage 优先 + 长期cookie(约10年)兜底,
               浏览器升级改变UA/插件等指纹组件时仍复用首次固化的ID, 不会被服务端识别为新设备 */
            getStoredDeviceId: function () {
                var id = "";
                try {
                    if (window.localStorage) {
                        id = window.localStorage.getItem(this.DEK) || "";
                    }
                } catch (e) {}
                if (!id) {
                    id = this.cookieGet(this.DEK);
                }
                if (id) {
                    // cookie 命中(如 localStorage 被清理)时回写自愈, 之后优先走 localStorage
                    try {
                        if (window.localStorage) {
                            window.localStorage.setItem(this.DEK, id);
                        }
                    } catch (e) {}
                }
                return id;
            },
            setStoredDeviceId: function (id) {
                try {
                    if (window.localStorage) {
                        window.localStorage.setItem(this.DEK, id);
                    }
                } catch (e) {}
                // cookie 双写: localStorage 被隐私工具清理等场景下仍可恢复设备ID
                this.cookieSet(this.DEK, id, 3650);
            },
            genLocalDeviceId: function () {
                // Fingerprint2 不可用时的本地随机兜底, 32位小写hex, 与 x64hash128 输出格式保持一致
                var hex = "0123456789abcdef";
                var id = "";
                for (var i = 0; i < 32; i++) {
                    id += hex.charAt(Math.floor(Math.random() * 16));
                }
                return id;
            },
            cookieGet: function (name) {
                var prefix = name + "=";
                var ca = document.cookie.split(";");
                for (var i = 0; i < ca.length; i++) {
                    var c = ca[i].replace(/^\s+/, "");
                    if (c.indexOf(prefix) === 0) {
                        try {
                            return decodeURIComponent(c.substring(prefix.length));
                        } catch (e) {
                            return "";
                        }
                    }
                }
                return "";
            },
            cookieSet: function (name, value, days) {
                var exp = "";
                if (typeof days === "number") {
                    var d = new Date();
                    d.setTime(d.getTime() + days * 86400000);
                    exp = ";expires=" + d.toGMTString();
                }
                document.cookie =
                    name + "=" + encodeURIComponent(value) + exp + ";path=/";
            },
            extend: function (destination, source) {
                var toString = Object.prototype.toString;
                for (var property in source) {
                    var sv = source[property];
                    var dv = destination[property];
                    // 双方均为纯对象时深合并, 使 options.danMuSetting 等嵌套配置按字段并入默认值而非整体覆盖;
                    // 数组/null/非对象仍整体赋值
                    if (
                        sv !== null &&
                        dv !== null &&
                        typeof sv === "object" &&
                        typeof dv === "object" &&
                        toString.call(sv) === "[object Object]" &&
                        toString.call(dv) === "[object Object]"
                    ) {
                        this.extend(dv, sv);
                    } else {
                        destination[property] = sv;
                    }
                }
                return destination;
            },
            init: function () {
                var _this = this;
                var options = arguments[0] || {};
                var appName = options.appName || "";
                // 单例保护: 同一 appName 且面板窗口仍然存在时视为重复调用, 直接忽略;
                // 面板已关闭(面板插件的关闭回调会调 closePusher 复位 _initedAppName)、
                // 或本次初始化本来就不建面板(没配 plugins:"panel", 如首页的"打开体验窗口")时放行,
                // 否则关掉窗口后再点按钮会被单例挡死, 窗口打不开
                if (
                    appName &&
                    _this._initedAppName === appName &&
                    $("#pushWebAnonymous").length > 0
                ) {
                    return;
                }
                // 递增初始化版本号: 让异步回调(Fingerprint2等)检测是否已被更新的 init 取代,
                // 避免旧 init 的异步回调在新 init 之后执行, 把新 init 创建的面板 closePusher 掉
                _this._initGen = (_this._initGen || 0) + 1;
                var myGen = _this._initGen;
                if (appName) {
                    _this._initedAppName = appName;
                }
                _this.initSetting(options, function () {
                    // 已有更新的 init 执行过, 放弃本次回调
                    if (_this._initGen !== myGen) {
                        return;
                    }
                    // 等插件就绪再建 UI: 插件脚本是异步注入的, 早于注册就跑 initPusherWindow 的话
                    // this.panel 还是 null, plugins=panel 时右上角面板不会自动弹出
                    _this.afterPluginsLoaded(function () {
                        // 插件加载期间可能又有新的 init 执行过, 再校验一次代次
                        if (_this._initGen !== myGen) {
                            return;
                        }
                        // 传入本次 init 的 channelCode, 避免并发 init 覆盖共享 s.channelCode 导致重复请求
                        _this.initPusherWindow(true, options.channelCode);
                    });
                });
            },
            /**
             * 销毁: 释放所有资源, 清理 DOM、事件、Socket.IO、定时器、缓存。
             * 销毁后可重新调用 init() 初始化。
             */
            destroy: function () {
                var _this = this;
                // 1) 停止 AI 弹幕轮询定时器
                if (_this.danMuTimer) {
                    window.clearTimeout(_this.danMuTimer);
                    _this.danMuTimer = null;
                }
                // 2) 断开 Socket.IO 连接
                if (_this.danMuSocket) {
                    try {
                        _this.danMuSocket.removeAllListeners();
                        _this.danMuSocket.disconnect();
                    } catch (e) {}
                    _this.danMuSocket = null;
                }
                _this.danMuSocketToken = null;
                _this.danMuDoc = null;
                // 3) 移除弹幕相关 DOM
                $("#pushWebAnonymous").remove();
                $("#pushWebDanIcon").remove();
                $("#pushWebDanMuHideStyle").remove();
                $("#pushWebDanMuAreaStyle").remove();
                $("#pushWebDanMuArea").remove();
                $(".barrage").remove();
                // 4) 清空弹幕去重缓存与队列
                _this.settings.danMuSeenIds = null;
                _this.settings.danMuSeenCount = 0;
                _this.settings.danMuPaused = false;
                _this.settings.danMuQueue = null;
                _this.settings.danMuSendOpened = false;
                _this.settings.danMuSetting.selector = "body";
                // 5) 清理 danmu-float.js 创建的浮窗
                var dmFloatWrap = document.querySelector(".dm-float-wrap");
                if (dmFloatWrap) {
                    dmFloatWrap.remove();
                }
                var dmSendBox = document.getElementById("dm-send-box");
                if (dmSendBox) {
                    dmSendBox.remove();
                }
                // 6) 复位单例标志, 允许重新 init
                _this._initedAppName = null;
                _this._initGen = 0;
            }
        };
        return WebsitePusher;
    })();
} catch (err) {
    console && console.log(err);
}
