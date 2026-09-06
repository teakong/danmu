// danmu.js —— 一行代码集成推送 + 弹幕的加载入口（本地版）
// 作用: 自动按序加载依赖(md5.js / socket.io.min.js / jquery.barrager.js / pusher.js)与 barrager.css,
//       读取 <script src="danmu.js?..."> 上携带的参数(appName/channelCode/danMu/aiDanMu/hideDialog/hidePanel),
//       就绪后调用 WebsitePusher.init(options) 完成弹幕/推送初始化。
// 用法:  <script src="static/js/danmu.js?appName=弹幕&channelCode=xxx&danMu=1"></script>
// 路径:  所有依赖均按 danmu.js 自身所在目录解析, 因此无论宿主页面放在哪都能正确加载。

// 单例保护: 防止重复点击/重复引入脚本导致 WebsitePusher.init 被多次调用
if (window._websitePusherInited) {
    // 已初始化或正在初始化, 直接跳过
} else {
    window._websitePusherInited = true;

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
    // tinycolor 供 pick-a-color 颜色选择器使用, 也可用于弹幕颜色处理
    var pusherScripts = [
        scriptDir + "md5.js",
        scriptDir + "socket.io.min.js",
        scriptDir + "jquery.barrager.js",
        scriptDir + "tinycolor-0.9.15.min.js",
        scriptDir + "pusher.js",
    ];
    if (typeof $ === "undefined" || typeof $.fn.jquery === "undefined") {
        pusherScripts.unshift(scriptDir + "jquery.min.js");
    } else {
        /* 低版本jQuery(<1.7)无 on/off, 用 bind/unbind + delegate/undelegate 兼容 */
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

    // 动态注入 barrager.css(弹幕样式), 路径相对 danmu.js 目录: js/../css/barrager.css
    var cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.href = scriptDir + "../css/barrager.css";
    document.head.appendChild(cssLink);

    seriesLoadPusherScripts(pusherScripts, function () {
        var urlParam =
            typeof WebsitePusher !== "undefined" && WebsitePusher.getUrlParam
                ? WebsitePusher.getUrlParam
                : function (name) {
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
                };
        // 如果js后指定channelCode不允许被url参数覆盖
        var channelCode = pusherParams["channelCode"]
            ? pusherParams["channelCode"]
            : urlParam("channelCode");
        var hideDialog =
            pusherParams["hideDialog"] == 1 ? 1 : urlParam("hideDialog");
        var hidePanel = pusherParams["hidePanel"] == 1 ? 1 : urlParam("hidePanel");
        var danMu = pusherParams["danMu"] == 1 ? 1 : urlParam("danMu");
        var aiDanMu =
            pusherParams["aiDanMu"] > 0
                ? pusherParams["aiDanMu"]
                : urlParam("aiDanMu");
        // appName 优先取 danmu.js src 参数, 其次取页面 URL 参数(兼容本地直接打开页面的场景)
        var appName = pusherParams["appName"]
            ? pusherParams["appName"]
            : urlParam("appName");
        if (appName) {
            if (typeof WebsitePusher === "undefined") {
                console &&
                console.error("WebsitePusher 未加载, pusher.js 可能加载失败");
                return;
            }
            WebsitePusher.init({
                appName: appName,
                channelCode: channelCode,
                hideDialog: hideDialog,
                hidePanel: hidePanel,
                danMu: danMu,
                danMuSetting: { aiDanMu: aiDanMu },
            });
        }
    });
}

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
