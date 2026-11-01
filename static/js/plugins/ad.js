/**
 * ad.js — 广告位插件（pusher.js 的 plugins/ 目录内的官方插件）
 *
 * 接入：
 *   WebsitePusher.init({ plugins: "ad" })
 *   或 <script src="//ws.phprm.com/static/customer/js/danmu.js?appName=xxx&channelCode=xxx&plugins=ad"></script>
 * 收到的广告消息（后端推来的原始 JSON）：
 *   { "messageId": "...", "head": "广告", "url": "...", "avatar": "...", "hold": 30 }
 * 行为：
 *   1) head == "广告" 的消息不渲染弹幕，改为在浏览器右下角展示 avatar 图片的广告位；
 *      但 avatar 为空时不算广告：不展示广告位，该条消息照常按普通弹幕渲染；
 *   2) 图片点击在新标签打开 url；
 *   3) 图片左上角画「广告」标识（白字 + 半透明背景 div），右上角画关闭按钮（点击关闭广告位）；
 *   4) 先从网络把图片加载完(onload)才显示广告位；加载失败则不显示（已有广告位保持原样）；
 *   5) hold 未传或 <=0 不管；hold>0 时从广告位显示开始计时，hold 秒后自动移除广告位
 *      （后端默认 hold=30 秒；在官网 https://push.phprm.com/ 可改这个停留秒数）；
 *      真实推送时后端回传的 hold 是布尔 true，表示"按后端默认时长"，插件按 30 秒处理；
 *   6) 广告位已存在、下一条广告图片也加载好时，只替换图片与 url，不重启计时器
 *      （首次展示时启动的计时继续跑，到点照常移除广告位）。
 *
 * 可选 settings（通过 WebsitePusher.init 传入，均有默认值）：
 *   adHead      广告消息的 head，默认 "广告"
 *   adText      左上角标识文字，默认 "广告"
 *   adRight     距右侧 px，默认 16
 *   adBottom    距底部 px，默认 18
 *   adMaxWidth  图片最大宽度 px，默认 320（<=0 表示不限宽）
 *   adMaxHeight 图片最大高度 px，默认 400（<=0 表示不限高）
 *   adZIndex    层级，默认 2147483646（比弹幕图标 2147483647 低一层）
 *
 * 说明：
 *   - 通过接管 settings.danMuMessageCallback 拿到原始消息（弹幕 item 里没有 hold 字段），
 *     命中广告消息返回 true，组件便不再渲染这条弹幕；其它消息原样交回上一个闸门
 *   - 同一 messageId 只展示一次，避免消息重投导致已关闭的广告又弹出来
 *   - 严格 ES5（不用 jQuery/箭头函数/let-const），不写 Cookie/localStorage，插件异常不影响弹幕主流程
 */
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) {
        return;
    }

    var NAME = "ad";
    // 广告消息的 head 默认值
    var DEFAULT_HEAD = "广告";
    // 左上角标识文字默认值
    var DEFAULT_TEXT = "广告";
    // 后端回传的 hold 是布尔 true 时，按后端默认停留秒数处理
    var DEFAULT_HOLD_SECONDS = 30;

    // 广告位容器 / 当前图片 / 图片外层链接
    var slot = null;
    var slotImg = null;
    var slotLink = null;
    // 自动移除计时器
    var timer = null;
    // 已展示过的 messageId(同一 messageId 只展示一次)
    var seen = {};
    var seenCount = 0;

    function log(msg) {
        if (typeof console != "undefined" && console.log) {
            console.log(msg);
        }
    }

    function str(value) {
        return value == null ? "" : String(value);
    }

    function trim(value) {
        var text = str(value);
        // IE8 没有 String.prototype.trim
        return typeof String.prototype.trim === "function"
            ? text.trim()
            : text.replace(/^\s+|\s+$/g, "");
    }

    // 去掉文档/配置里偶尔带上的首尾反引号(`)
    function stripBacktick(value) {
        var text = trim(value);
        while (text.length >= 2 && text.charAt(0) === "`" && text.charAt(text.length - 1) === "`") {
            text = trim(text.substring(1, text.length - 1));
        }
        return text.replace(/^`+|`+$/g, "");
    }

    // 读整型 settings，非法值回退默认
    function intSetting(settings, key, def) {
        if (settings && settings[key] != null) {
            var num = parseInt(settings[key], 10);
            if (!isNaN(num) && num >= 0) {
                return num;
            }
        }
        return def;
    }

    function textSetting(settings, key, def) {
        var text = settings ? trim(settings[key]) : "";
        return text === "" ? def : text;
    }

    // 事件绑定(带 IE8 兼容)
    function bindEvent(el, type, handler) {
        if (el.addEventListener) {
            el.addEventListener(type, handler, false);
        } else if (el.attachEvent) {
            el.attachEvent("on" + type, function () {
                handler(window.event);
            });
        }
    }

    function stopEvent(event) {
        if (!event) {
            return;
        }
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        event.returnValue = false;
        event.cancelBubble = true;
    }

    // 读数值 settings(允许负数/0，用于表示"不限制")，非法值回退默认
    function numSetting(settings, key, def) {
        var num = settings && settings[key] != null ? parseInt(settings[key], 10) : NaN;
        return isNaN(num) ? def : num;
    }

    // 图片宽高上限: 分开配置, <=0 表示该方向不限制; 只给上限, 图片按原比例缩放
    function applyImgStyle(settings, img) {
        var maxWidth = numSetting(settings, "adMaxWidth", 320);
        var maxHeight = numSetting(settings, "adMaxHeight", 400);
        var css = "display:block;border:0;";
        if (maxWidth > 0) {
            css += "max-width:" + maxWidth + "px;";
        }
        if (maxHeight > 0) {
            css += "max-height:" + maxHeight + "px;";
        }
        img.style.cssText = css;
        img.alt = textSetting(settings, "adText", DEFAULT_TEXT);
    }

    // 先从网络加载图片，加载成功才回调（保证出现在页面上时已经有图）
    function loadImage(settings, src, onReady) {
        var img = new Image();
        var done = false;
        img.onload = function () {
            if (done) {
                return;
            }
            done = true;
            img.onload = img.onerror = null;
            applyImgStyle(settings, img);
            onReady(img);
        };
        img.onerror = function () {
            if (done) {
                return;
            }
            done = true;
            img.onload = img.onerror = null;
            log("ad 插件：广告图片加载失败，本次不展示: " + src);
        };
        img.src = src;
    }

    function clearTimer() {
        if (timer != null) {
            window.clearTimeout(timer);
            timer = null;
        }
    }

    function removeSlot() {
        clearTimer();
        if (slot && slot.parentNode) {
            slot.parentNode.removeChild(slot);
        }
        slot = null;
        slotImg = null;
        slotLink = null;
    }

    // 首次展示才开始计时: hold 秒后自动移除广告位
    function startTimer(seconds) {
        clearTimer();
        timer = window.setTimeout(function () {
            timer = null;
            removeSlot();
        }, seconds * 1000);
    }

    // 设置图片的跳转地址; 没有 url 时去掉 href, 点击不跳转
    function setHref(href) {
        if (!slotLink) {
            return;
        }
        if (href) {
            slotLink.setAttribute("href", href);
            slotLink.style.cursor = "pointer";
        } else {
            slotLink.removeAttribute("href");
            slotLink.style.cursor = "default";
        }
    }

    // 广告位已存在: 只替换图片与 url, 不重启计时器
    function replaceAd(settings, img, href) {
        if (!slotLink) {
            return;
        }
        if (slotImg && slotImg.parentNode === slotLink) {
            slotLink.removeChild(slotImg);
        }
        slotLink.appendChild(img);
        slotImg = img;
        setHref(href);
        applyImgStyle(settings, img);
    }

    // 创建右下角广告位: 左上半透明「广告」标识 + 右上角关闭按钮 + 图片链接
    function createSlot(settings, img, href) {
        var wrap = document.createElement("div");
        wrap.id = "pushWebAd";
        wrap.style.cssText =
            "position:fixed;" +
            "right:" + intSetting(settings, "adRight", 16) + "px;" +
            "bottom:" + intSetting(settings, "adBottom", 18) + "px;" +
            "z-index:" + intSetting(settings, "adZIndex", 2147483646) + ";" +
            "line-height:0;";

        // 左上角标识: 白色文字 + 半透明背景
        var label = document.createElement("div");
        label.id = "pushWebAdLabel";
        label.style.cssText =
            "position:absolute;left:0;top:0;padding:2px 6px;z-index:2;" +
            "font:12px/16px Arial,sans-serif;color:#fff;background:rgba(0,0,0,.45);";
        label.appendChild(document.createTextNode(textSetting(settings, "adText", DEFAULT_TEXT)));

        // 右上角关闭按钮：30x30 命中区(比原来的 20x20 放大 50%)，更好点
        var close = document.createElement("div");
        close.id = "pushWebAdClose";
        close.style.cssText =
            "position:absolute;right:0;top:0;width:30px;height:30px;z-index:2;" +
            "font:21px/30px Arial,sans-serif;text-align:center;color:#fff;" +
            "background:rgba(0,0,0,.45);cursor:pointer;";
        close.title = "关闭广告";
        close.appendChild(document.createTextNode("×"));
        bindEvent(close, "click", function (event) {
            stopEvent(event);
            removeSlot();
        });

        // 图片 + 新标签跳转
        var link = document.createElement("a");
        link.id = "pushWebAdLink";
        link.target = "_blank";
        link.setAttribute("rel", "noopener noreferrer");
        link.style.cssText = "display:block;";
        link.appendChild(img);

        wrap.appendChild(label);
        wrap.appendChild(close);
        wrap.appendChild(link);
        (document.body || document.documentElement).appendChild(wrap);

        slot = wrap;
        slotImg = img;
        slotLink = link;
        setHref(href);
    }

    // 处理一条广告消息（调用前已确认 avatar 非空）
    function handleAd(settings, message) {
        var src = stripBacktick(message.avatar);
        if (src === "") {
            // 兜底: 没有图片就不展示广告位(闸门已拦掉, 正常不会走到这)
            return;
        }
        var href = stripBacktick(message.url);
        // 同一 messageId 只展示一次(关掉后即便消息重投也不再弹)
        var id = trim(message.messageId != null ? message.messageId : message.messagePushId);
        if (id !== "") {
            if (seen[id]) {
                return;
            }
            seen[id] = true;
            seenCount += 1;
            if (seenCount > 500) {
                seen = {};
                seenCount = 1;
                seen[id] = true;
            }
        }
        // hold 未传或非正数 = 不自动移除; 后端真实推送回传的是布尔 true,
        // 表示"按后端默认停留时长", 这时用默认 30 秒
        var hold = message.hold;
        if (hold === true) {
            hold = DEFAULT_HOLD_SECONDS;
        } else {
            hold = parseInt(hold, 10);
            if (isNaN(hold) || hold <= 0) {
                hold = 0;
            }
        }
        loadImage(settings, src, function (img) {
            if (slot) {
                // 广告位已存在: 图片已就绪, 只换图和 url; 计时器不重启
                replaceAd(settings, img, href);
                return;
            }
            createSlot(settings, img, href);
            if (hold > 0) {
                startTimer(hold);
            }
        });
    }

    // 取广告消息的 head: settings.adHead 可运行时修改，每次现读
    function getAdHead(settings) {
        return textSetting(settings, "adHead", DEFAULT_HEAD);
    }

    WebsitePusher.registerPlugin(NAME, function (settings) {
        if (!settings) {
            log("ad 插件：缺少 settings，跳过广告位");
            return;
        }
        var origin = settings.danMuMessageCallback;
        settings.danMuMessageCallback = function (message) {
            var head = trim(message && message.head);
            // avatar 为空: 不展示广告位, 该条按普通弹幕消息走(交回原闸门/照常渲染)
            if (head === getAdHead(settings) && stripBacktick(message.avatar) !== "") {
                handleAd(settings, message);
                // 返回 true: 组件不再把这条消息渲染成弹幕
                return true;
            }
            // 其它消息交回原有闸门(默认返回 false, 照常渲染弹幕)
            if (typeof origin == "function") {
                return origin.call(settings, message);
            }
            return false;
        };
    });
})();
