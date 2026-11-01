// danmu.js —— 一行代码集成推送 + 弹幕的加载入口
// 作用: 自动按序加载依赖(md5.js / socket.io.min.js / jquery.barrager.js / pusher.js)与 barrager.css,
//       读取 <script src="danmu.js?..."> 上携带的参数(appName/channelCode/danMu/aiDanMu/hideDialog/hideIcon/plugins),
//       就绪后调用 WebsitePusher.init(options) 完成弹幕/推送/插件初始化。
// 用法:  <script src="static/js/danmu.js?appName=弹幕&channelCode=xxx&danMu=1"></script>
//        访问统计: <script src="static/js/danmu.js?appName=xxx&channelCode=xxx&plugins=stat"></script>
//        右上角面板: <script src="static/js/danmu.js?appName=xxx&channelCode=xxx&danMu=1&plugins=panel"></script>
// 路径:  所有依赖均按 danmu.js 自身所在目录解析, 因此无论宿主页面放在哪都能正确加载。
// 安全:  不使用 URL 参数改变插件目录(pluginsSite), 插件目录始终是 danmu.js 同目录的 plugins/;
//        业务方确需自定义时, 请在代码里 WebsitePusher.init({ pluginsSite: "..." }) 显式指定。

// 单例保护: 防止重复引入脚本导致 WebsitePusher.init 被多次调用
// 用当前 script 标签的 data 属性做标记, 不污染 window
(function () {
    var curScript = (function () {
        var scripts = document.getElementsByTagName("script");
        for (var i = scripts.length - 1; i >= 0; i--) {
            if (scripts[i].src && scripts[i].src.indexOf("danmu.js") > -1) {
                return scripts[i];
            }
        }
        return null;
    })();
    if (curScript && curScript.getAttribute("data-danmu-loaded")) return;
    if (curScript) curScript.setAttribute("data-danmu-loaded", "1");

    // 解析 danmu.js 自身的 <script src> 地址, 用于:
    //   1) 提取所在目录, 拼接依赖 JS / CSS 的相对路径
    //   2) 提取 src 上携带的查询参数(appName/channelCode/danMu ...)
    function getPusherScriptUrl() {
        var scripts = document.getElementsByTagName("script");
        // 倒序查找: 取最后一个 src 含 "danmu.js" 的 script 标签(兼容本地与远程引入)
        for (var i = scripts.length - 1; i >= 0; i--) {
            if (
                scripts[i].src &&
                scripts[i].src.indexOf("danmu.js") > -1
            ) {
                return scripts[i].src;
            }
        }
        return null;
    }

    // 取 danmu.js 所在目录(含末尾斜杠), 例: "static/js/"
    function getPusherScriptDir(url) {
        if (!url) return "";
        var q = url.indexOf("?");
        if (q > -1) url = url.substring(0, q);
        var idx = url.lastIndexOf("/");
        return idx > -1 ? url.substring(0, idx + 1) : "";
    }

    function getPusherQueryParams(url) {
        var params = {};
        if (!url) return params;
        if (url.indexOf("?") > -1) {
            var queryString = url.split("?")[1];
            var pairs = queryString.split("&");
            for (var i = 0; i < pairs.length; i++) {
                var pair = pairs[i].split("=");
                params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
            }
        }
        return params;
    }

    var danmuScriptUrl = getPusherScriptUrl();
    var scriptDir = getPusherScriptDir(danmuScriptUrl);
    var pusherParams = getPusherQueryParams(danmuScriptUrl);

    // 依赖 JS 列表(按序加载), 全部相对 danmu.js 目录解析
    // 本仓库只发布可读源码(带注释), 不提供 pusher.min.js / jquery.barrager.min.js 压缩版
    var pusherScripts = [];
    if (typeof $ === "undefined" || typeof $.fn.jquery === "undefined") {
        pusherScripts.push(scriptDir + "jquery.min.js");
    }
    if (typeof hex_md5 === "undefined") {
        pusherScripts.push(scriptDir + "md5.js");
    }
    if (typeof io === "undefined") {
        pusherScripts.push(scriptDir + "socket.io.min.js");
    }
    if (typeof $ !== "undefined" && $.fn && typeof $.fn.barrager === "undefined") {
        pusherScripts.push(scriptDir + "jquery.barrager.js");
    } else if (typeof $ === "undefined") {
        pusherScripts.push(scriptDir + "jquery.barrager.js");
    }
    pusherScripts.push(scriptDir + "pusher.js");

    // jQuery 兼容补丁（仅在页面已有 jQuery 且版本 < 1.7 时打）
    if (typeof $ !== "undefined" && typeof $.fn.jquery !== "undefined") {
        if (!$.fn.on) {
            $.fn.on = function (types, selector, data, fn) {
                if (typeof selector === "function") {
                    fn = selector;
                    selector = null;
                    data = null;
                } else if (typeof data === "function") {
                    fn = data;
                    data = null;
                }
                if (selector) {
                    return this.delegate(selector, types, data, fn);
                }
                return this.bind(types, data, fn);
            };
        }
        if (!$.fn.off) {
            $.fn.off = function (types, selector, fn) {
                if (typeof selector === "function") {
                    fn = selector;
                    selector = null;
                }
                if (selector) {
                    return this.undelegate(selector, types, fn);
                }
                return this.unbind(types, fn);
            };
        }
    }

    // 动态注入 barrager.css(弹幕样式), 已注入则跳过
    if (!document.querySelector('link[data-danmu-barrager]')) {
        var cssLink = document.createElement("link");
        cssLink.rel = "stylesheet";
        cssLink.href = scriptDir + "../css/barrager.css";
        cssLink.setAttribute("data-danmu-barrager", "1");
        document.head.appendChild(cssLink);
    }

    // 按序加载依赖脚本
    function seriesLoadPusherScripts(scripts, callback) {
        if (typeof scripts != "object") {
            scripts = [scripts];
        }
        var HEAD =
            document.getElementsByTagName("head").item(0) || document.documentElement;
        var s = new Array();
        var last = scripts.length - 1;
        var recursiveLoad = function (i) {
            s[i] = document.createElement("script");
            s[i].setAttribute("type", "text/javascript");
            s[i].setAttribute("charset", "UTF-8");
            s[i].onload = s[i].onreadystatechange = function () {
                if (
                    navigator.userAgent.indexOf("MSIE") == -1 ||
                    this.readyState == "loaded" ||
                    this.readyState == "complete"
                ) {
                    this.onload = this.onreadystatechange = null;
                    this.parentNode.removeChild(this);
                    if (i != last) {
                        recursiveLoad(i + 1);
                    } else if (typeof callback == "function") {
                        callback();
                    }
                }
            };
            s[i].setAttribute("src", scripts[i]);
            HEAD.appendChild(s[i]);
        };
        recursiveLoad(0);
    }

    seriesLoadPusherScripts(pusherScripts, function () {
        function getUrlParam(name) {
            var aQuery = window.location.href.split("?");
            if (aQuery.length < 2) return "";
            var aBuf = aQuery[1].split("&");
            for (var i = 0; i < aBuf.length; i++) {
                var aTmp = aBuf[i].split("=");
                if (aTmp.length >= 2 && aTmp[0] == name) {
                    var val = aTmp[1];
                    return val.indexOf("#") != -1
                        ? val.substring(0, val.indexOf("#"))
                        : val;
                }
            }
            return "";
        }
        // 如果js后指定channelCode不允许被url参数覆盖
        var channelCode = pusherParams["channelCode"]
            ? pusherParams["channelCode"]
            : getUrlParam("channelCode");
        var hideDialog =
            pusherParams["hideDialog"] == 1 ? 1 : getUrlParam("hideDialog");
        var danMu = pusherParams["danMu"] == 1 ? 1 : getUrlParam("danMu");
        var aiDanMu =
            pusherParams["aiDanMu"] > 0
                ? pusherParams["aiDanMu"]
                : getUrlParam("aiDanMu");
        // hideIcon: 1=不创建右下角浮窗图标(只出广告位/面板等, 页面更干净)
        var hideIcon =
            pusherParams["hideIcon"] == 1 || getUrlParam("hideIcon") == 1 ? 1 : 0;
        // appName 优先取 danmu.js src 参数, 其次取页面 URL 参数(兼容本地直接打开页面的场景)
        var appName = pusherParams["appName"]
            ? pusherParams["appName"]
            : getUrlParam("appName");
        // autoInit: 默认 1=自动初始化, 0=仅加载依赖不初始化, 由业务方自行调用 WebsitePusher.init()
        var autoInit = pusherParams["autoInit"] == 0 ? 0 : 1;
        // plugins: 插件名(英文逗号分隔, 可一次加载多个, 如 plugins=stat,foo)
        // 不传=不加载插件(也没有右上角面板); 需要面板时写 plugins=panel 或 plugins=stat,panel
        var plugins =
            pusherParams["plugins"] != null
                ? pusherParams["plugins"]
                : getUrlParam("plugins");
        // pluginsSite: 插件目录固定为 danmu.js 同目录下的 plugins/, 本地与线上均按 danmu.js 自身位置解析
        // 安全: 不再允许通过 URL 传 pluginsSite, 避免被拼出任意站点的 js 当插件加载
        //       业务方确需自定义时, 只能在代码里 WebsitePusher.init({ pluginsSite: "..." }) 显式指定
        var pluginsSite = scriptDir + "plugins/";
        // 让业务方手动 init() 时也默认用 danmu.js 同目录的 plugins/(仅改默认值, 仍不接受 URL 覆盖)
        if (typeof WebsitePusher !== "undefined" && WebsitePusher.settings) {
            WebsitePusher.settings.pluginsSite = pluginsSite;
        }

        // 触发 websitePusherReady 自定义事件, 通知业务方依赖已加载完成
        // 业务方可以监听此事件后再调用 WebsitePusher.init() 传入自定义参数
        function triggerReady() {
            var evt;
            if (typeof CustomEvent === "function") {
                evt = new CustomEvent("websitePusherReady", {
                    detail: { WebsitePusher: WebsitePusher }
                });
            } else {
                // IE 兼容
                evt = document.createEvent("CustomEvent");
                evt.initCustomEvent("websitePusherReady", false, false, {
                    WebsitePusher: WebsitePusher
                });
            }
            document.dispatchEvent(evt);
            // 同时支持全局回调
            if (typeof window.onWebsitePusherReady === "function") {
                window.onWebsitePusherReady(WebsitePusher);
            }
        }

        if (appName) {
            if (typeof WebsitePusher === "undefined") {
                console &&
                console.error("WebsitePusher 未加载, pusher.js 可能加载失败");
                return;
            }
            // 单例标记, 防止重复 init
            if (WebsitePusher._inited) return;
            WebsitePusher._inited = true;
            if (autoInit) {
                WebsitePusher.init({
                    appName: appName,
                    channelCode: channelCode,
                    hideDialog: hideDialog,
                    danMu: danMu,
                    danMuSetting: { aiDanMu: aiDanMu, hideIcon: hideIcon },
                    plugins: plugins,
                    pluginsSite: pluginsSite,
                });
            }
            triggerReady();
        } else {
            // 没有 appName 也触发 ready, 让业务方可以手动 init
            if (typeof WebsitePusher !== "undefined") {
                if (WebsitePusher._inited) return;
                WebsitePusher._inited = true;
                triggerReady();
            }
        }
    });
})();
