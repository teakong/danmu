/**
 * stat.js — 访问统计插件（pusher.js 的 plugins/ 目录内的官方插件）
 *
 * 接入：
 *   <script src="//ws.phprm.com/static/customer/js/danmu.js?appName=xxx&channelCode=xxx&plugins=stat"></script>
 * 行为：
 *   1) 页面每次加载：向当前通道触发一条 head=visit 的推送，url 取当前页面地址；
 *   2) 页面任意元素被点击：再触发一条 head=click 的推送，url 为当前页面地址，
 *      body 为被点元素的「点击描述」，例如：
 *          body > div.wrap > div.card:nth-of-type(2) > button#btnLogin "登录" @ 34.5%,20.1%
 *      描述由「祖先路径 + 元素 id/class + 文本片段 + 点击坐标」拼成，不是整段 HTML，
 *      所以点到 body/大容器时也只有一小条可定位的信息。
 *   通道后台的「访问统计看板」据此统计 PV/UV、来源、设备与点击热点。
 *
 * 可选 settings（通过 WebsitePusher.init 传入，均有默认值）：
 *   statHead   访问记录类型，默认 "visit"
 *   statClick  0=不上报点击（默认 1=上报）
 *
 * 说明：
 *   - 不写 Cookie/localStorage，不做 DOM 操作，请求失败静默处理，不影响宿主页面
 *   - 点击监听走捕获阶段，业务代码 stopPropagation 也不影响记录；组件自身 UI
 *     （面板/弹幕/挂件等）的点击不上报，避免把自己的界面操作刷进统计
 *   - 描述长度上限 1000 字符：上报走 POST + JSON(pushTrigger), 不占 URL 长度,
 *     所以可以保留更深的祖先路径；服务端正文上限 5 万字符，1000 字符远低于它
 *   - 子元素超过 3 个的元素(如 body/大卡片)只记路径不记文本，避免把整页文字当成点击内容
 *   - 上报统一走 WebsitePusher.pushTrigger：通道码由组件按当前网址异步认领时，
 *     会先等它出现（最多 10 秒），等不到就不上报（没有通道也没有可归属的统计）
 *   - 通过 WebsitePusher.registerPlugin 注册，由组件 loadPlugins 加载完成后执行 run(settings)
 */
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) {
        return;
    }
    // 点击去噪用组件自带的 jQuery；宿主未提供时只放弃点击上报，访问上报照常
    var hasJquery = typeof $ != "undefined" && typeof $.fn != "undefined";

    var NAME = "stat";
    // 点击描述的字符上限(整条 body)：上报走 POST + JSON, 不受 URL 长度限制,
    // 1000 字符足够保留完整祖先路径, 又远低于服务端 5 万字符的正文上限
    var MAX_BODY_LENGTH = 1000;
    // 祖先路径最多保留几段(从被点元素往上数，超出用 … 省略)
    var MAX_PATH_DEPTH = 6;
    // 文本片段最多保留多少字符
    var MAX_TEXT_LENGTH = 60;
    // 元素子元素超过这个数视为容器，只记路径不记文本(避免把整块区域甚至整页的文字带上去)
    var MAX_CONTAINER_DESCENDANTS = 3;
    // 组件自身 UI 的点击不上报，避免自己的面板/弹幕操作刷满统计
    var IGNORE_SELECTOR =
        "#pusherFrame,#pushWebDanIcon,#pushWebDanMuArea,#pushWebAnonymous," +
        ".barrage,.dm-float-wrap,#dm-send-box,.layui-layer";
    var clickBound = false;

    function log(msg) {
        if (typeof console != "undefined" && console.log) {
            console.log(msg);
        }
    }

    function tagOf(el) {
        return el && el.tagName ? String(el.tagName).toLowerCase() : "";
    }

    // 取元素的前几个 class，拼成 .a.b 形式
    function classesOf(el, max) {
        var raw = el && el.className;
        if (!raw || typeof raw != "string") {
            return [];
        }
        var list = raw.replace(/^\s+|\s+$/g, "").split(/\s+/);
        var out = [];
        for (var i = 0; i < list.length && out.length < max; i++) {
            if (list[i]) {
                out.push("." + list[i]);
            }
        }
        return out;
    }

    // 同一父节点下第几个同标签元素；只有一个时返回 0(不需要写序号)
    function sameTagIndex(el) {
        var parent = el && el.parentNode;
        if (!parent || !parent.children) {
            return 0;
        }
        var tag = tagOf(el);
        var same = 0;
        var index = 0;
        for (var i = 0; i < parent.children.length; i++) {
            var child = parent.children[i];
            if (tagOf(child) !== tag) {
                continue;
            }
            same++;
            if (child === el) {
                index = same;
            }
        }
        return same > 1 ? index : 0;
    }

    // 单段路径：tag#id 或 tag.class:nth-of-type(n)
    function segmentOf(el) {
        var tag = tagOf(el);
        if (!tag || tag === "html") {
            return "";
        }
        if (el.id) {
            return tag + "#" + el.id;
        }
        var seg = tag + classesOf(el, 2).join("");
        var index = sameTagIndex(el);
        return index ? seg + ":nth-of-type(" + index + ")" : seg;
    }

    // 祖先路径：body > div.wrap > div.card > button#btnLogin
    function pathOf(el) {
        var parts = [];
        var node = el;
        var cut = false;
        while (node && node.nodeType === 1 && tagOf(node) !== "html") {
            var seg = segmentOf(node);
            if (seg) {
                parts.unshift(seg);
            }
            if (parts.length >= MAX_PATH_DEPTH) {
                var parent = node.parentNode;
                cut = !!(parent && parent.nodeType === 1 && tagOf(parent) !== "html");
                break;
            }
            node = node.parentNode;
        }
        return (cut ? "… > " : "") + parts.join(" > ");
    }

    // 元素里的子元素数量；body/大卡片这类容器才有文本，叶子元素没有
    function descendantsOf(el) {
        if (el && el.getElementsByTagName) {
            return el.getElementsByTagName("*").length;
        }
        return el && el.children ? el.children.length : 0;
    }

    // 元素文本片段；容器类元素(子元素多)不带文本，否则点到 body 会把整页文字带上去
    function textOf(el) {
        if (descendantsOf(el) > MAX_CONTAINER_DESCENDANTS) {
            return "";
        }
        var text = (el.textContent || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
        if (text.length > MAX_TEXT_LENGTH) {
            text = text.substring(0, MAX_TEXT_LENGTH) + "…";
        }
        return text;
    }

    // 点击坐标(相对页面宽/高的百分比)：点到空白处也能看出点在页面什么位置
    function posOf(evt) {
        // 代码里 element.click() 这类合成事件没有真实坐标(恒为 0,0)，不写坐标免得误导
        if (evt && evt.isTrusted === false && !evt.clientX && !evt.clientY) {
            return "";
        }
        var doc = document.documentElement;
        var winW = window.innerWidth || (doc && doc.clientWidth) || 0;
        var docH = (doc && doc.scrollHeight) || 0;
        if (!winW || !docH || !evt || evt.clientX == null) {
            return "";
        }
        var scrollY = window.pageYOffset || (doc && doc.scrollTop) || 0;
        var x = Math.round(evt.clientX * 1000 / winW) / 10;
        var y = Math.round((evt.clientY + scrollY) * 1000 / docH) / 10;
        return x + "%," + y + "%";
    }

    // 被点元素的点击描述：路径 + 文本片段 + 链接 + 坐标，超长截断
    function getClickDesc(target, evt) {
        if (!target || target.nodeType !== 1) {
            return "";
        }
        var desc = pathOf(target);
        var text = textOf(target);
        if (text) {
            desc += ' "' + text + '"';
        }
        var href = target.getAttribute ? target.getAttribute("href") : null;
        if (href && href.indexOf("javascript:") !== 0) {
            desc += " -> " + (href.length > 60 ? href.substring(0, 60) + "…" : href);
        }
        var pos = posOf(evt);
        if (pos) {
            desc += " @ " + pos;
        }
        if (desc.length > MAX_BODY_LENGTH) {
            desc = desc.substring(0, MAX_BODY_LENGTH);
        }
        return desc;
    }

    // 绑定点击上报；只绑一次，重复 init 不会重复上报
    function bindClick() {
        if (clickBound) {
            return;
        }
        clickBound = true;
        var onDocClick = function (event) {
            var evt = event || window.event;
            var target = evt.target || evt.srcElement;
            // 忽略组件自身 UI 上的点击
            if (
                hasJquery &&
                typeof $.fn.closest == "function" &&
                $(target).closest(IGNORE_SELECTOR).length
            ) {
                return;
            }
            // 通道码还没认领到就没有可上报的通道；pushTrigger 内部也会再等一次，这里只做快速跳过
            if (!WebsitePusher.settings || !WebsitePusher.settings.channelCode) {
                return;
            }
            WebsitePusher.pushTrigger("click", getClickDesc(target, evt));
        };
        if (document.addEventListener) {
            // 捕获阶段监听：业务代码 stopPropagation 也不会漏掉这次点击
            document.addEventListener("click", onDocClick, true);
        } else if (document.attachEvent) {
            // IE8 兼容
            document.attachEvent("onclick", onDocClick);
        }
    }

    WebsitePusher.registerPlugin(NAME, function (settings) {
        if (!settings) {
            log("stat 插件：缺少 settings，跳过访问上报");
            return;
        }
        // 1) 访问上报：每次页面加载一条 head=visit（pushTrigger 内部会等通道码认领）
        WebsitePusher.pushTrigger(settings.statHead || "visit");
        // 2) 点击上报：任意元素被点击一条 head=click，body=被点元素的点击描述
        if (settings.statClick != 0) {
            bindClick();
        }
    });
})();
