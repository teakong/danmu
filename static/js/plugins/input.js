/**
 * input.js — 弹幕发送输入框插件（plugins/ 目录内的官方插件）
 *
 * 接入（二选一）：
 *   <script src="//ws.phprm.com/static/customer/js/danmu.js?appName=xxx&channelCode=xxx&danMu=1&plugins=input"></script>
 *   WebsitePusher.init({ appName: "xxx", channelCode: "xxx", plugins: "input" });
 *
 * 行为：
 *   1) 点击右下角弹幕图标展开底部输入框，再次点击图标收起；
 *   2) 输入框支持回车发送、Esc 关闭、右上角 × 关闭；
 *   3) 发送走 GET {triggerUrl}{channelCode}?head=&avatar=&url=，所有订阅同一通道的页面都能收到，
 *      正文（弹幕内容）放在 head 里，和 README「无后端集成」的示例一致；
 *      url 会追加 pushTime=HH:MM:SS：后端对同一 url 的触发 1 分钟内去重，不带就会「发送成功但弹幕没有」；
 *   4) 组件不要求 hideDialog=1：输入框由图标回调触发，与右上角推送面板互不影响。
 *
 * 说明：
 *   - 发送框样式内联在插件里，不额外请求 css/图片，CDN 只同步 js 目录也不会样式缺失；
 *   - 严格 ES5、不依赖 jQuery（通道码未认领时用 waitChannelCode 等它就绪，等不到就放弃）；
 *   - 关闭时把 settings.danMuSendOpened 复位，图标下次点击仍然是「打开」而不是「关闭」；
 *   - 输入框 id 用 dm-send-box，destroy() 会一并清除，stat 插件也不会把框内点击计入统计。
 */
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) {
        return;
    }

    var NAME = "input";
    var CSS_ID = "danmu-input-css";
    var BOX_ID = "dm-send-box";
    var MAX_LENGTH = 60;
    var DEFAULT_TRIGGER = "https://www.phprm.com/services/push/trigger/";

    // 多语言: 宿主页面提供 window.__t(push-front 的 shared.*.js)时用它, 缺字典时回退中文
    function t(key, fallback) {
        return typeof window.__t === "function" ? window.__t(key, fallback) : fallback;
    }

    var box = null;
    var field = null;
    var hookedSettings = null;

    function log(msg) {
        if (typeof console !== "undefined" && console.log) {
            console.log(msg);
        }
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function isAttached(node) {
        if (!node) {
            return false;
        }
        if (document.body && document.body.contains) {
            return document.body.contains(node);
        }
        var parent = node;
        while (parent) {
            if (parent === document.body) {
                return true;
            }
            parent = parent.parentNode;
        }
        return false;
    }

    function bindEvent(el, type, handler) {
        if (el.addEventListener) {
            el.addEventListener(type, handler, false);
        } else if (el.attachEvent) {
            el.attachEvent("on" + type, function () {
                handler(window.event);
            });
        }
    }

    function settingsOf() {
        return WebsitePusher && WebsitePusher.settings ? WebsitePusher.settings : null;
    }

    /* ---------- 样式 ---------- */

    function injectCSS() {
        if (byId(CSS_ID)) {
            return;
        }
        var css = [
            ".dm-input-box {",
            "  position: fixed; left: 50%; bottom: 20px; bottom: calc(20px + env(safe-area-inset-bottom));",
            "  transform: translateX(-50%); z-index: 2147483645;",
            "  display: flex; align-items: center; gap: 8px;",
            "  width: min(520px, calc(100vw - 32px)); box-sizing: border-box;",
            "  padding: 10px 12px; background: #fff; border: 1px solid #e8e5f0; border-radius: 14px;",
            "  box-shadow: 0 10px 30px rgba(0,0,0,.18);",
            "  font-size: 13px; font-family: inherit;",
            "}",
            ".dm-input-field {",
            "  flex: 1; min-width: 0; height: 36px; box-sizing: border-box; padding: 0 12px;",
            "  border: 1px solid #d6d0ea; border-radius: 8px; background: #fff;",
            "  color: #1f1b2e; font-size: 14px; font-family: inherit; outline: none;",
            "}",
            ".dm-input-field::placeholder { color: #9a95ad; }",
            ".dm-input-field:focus {",
            "  border-color: #0f766e; box-shadow: 0 0 0 2px rgba(15,118,110,.15);",
            "}",
            ".dm-input-send {",
            "  flex: none; height: 36px; padding: 0 18px; border: none; border-radius: 8px;",
            "  background: #0f766e; color: #fff; font-size: 14px; font-family: inherit;",
            "  cursor: pointer;",
            "}",
            ".dm-input-send:hover { background: #0b5d56; }",
            ".dm-input-send:active { transform: scale(.97); }",
            // 行高 14 而非 18：× 的墨迹偏基线，行高等于内容高时整体低约 2px，压一行高才在圆里居中
            // × 用 SVG 画：字体字形偏基线，行高怎么调都随宿主字体偏 1~2px，画出来才能几何居中
            ".dm-input-close {",
            "  position: absolute; top: -9px; right: -9px; width: 22px; height: 22px;",
            "  box-sizing: border-box; display: flex; align-items: center; justify-content: center;",
            "  border: 2px solid #fff; border-radius: 50%;",
            "  background: #0f766e; color: #fff; cursor: pointer; user-select: none;",
            "}",
            ".dm-input-close svg { display: block; width: 10px; height: 10px; }",
            ".dm-input-close:hover { background: #0b5d56; }",
            "@media (max-width: 640px) {",
            "  .dm-input-box {",
            "    left: 12px; right: 72px; width: auto; transform: none;",
            "    bottom: 12px; bottom: calc(12px + env(safe-area-inset-bottom));",
            "  }",
            "}"
        ].join("\n");
        var style = document.createElement("style");
        style.id = CSS_ID;
        if (style.styleSheet) {
            // IE8 必须先入文档再写 cssText
            var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
            head.appendChild(style);
            style.styleSheet.cssText = css;
            return;
        }
        style.innerHTML = css;
        (document.head || document.getElementsByTagName("head")[0] || document.documentElement)
            .appendChild(style);
    }

    /* ---------- 发送 ---------- */

    function triggerBase(settings) {
        var base = settings.triggerUrl || DEFAULT_TRIGGER;
        return base.charAt(base.length - 1) === "/" ? base : base + "/";
    }

    // 后端对同一个 url 参数的触发 1 分钟内去重：同页连发时后面几条会被静默丢弃。
    // 网址带上精确到秒的 pushTime 后每次都是新消息（与 push-h5 的 date("H:i:s") 一致）；
    // 网址本身已带 pushTime 时替换旧值，避免出现两个 pushTime 而读到旧时间
    function pageUrl() {
        var url = window.location.href;
        var d = new Date();
        var pad = function (num) {
            return (num < 10 ? "0" : "") + num;
        };
        var time = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
        var hashAt = url.indexOf("#");
        var head = hashAt === -1 ? url : url.slice(0, hashAt);
        var tail = hashAt === -1 ? "" : url.slice(hashAt);
        if (/[?&]pushTime=[^&#]*/i.test(head)) {
            head = head.replace(/([?&])pushTime=[^&#]*/gi, "$1pushTime=" + time);
        } else {
            head += (head.indexOf("?") === -1 ? "?" : "&") + "pushTime=" + time;
        }
        return head + tail;
    }

    function request(url) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.send(null);
        } catch (e) {
            // 跨域被拦或环境不支持时静默失败，不影响弹幕本身
            log(e);
        }
    }

    function submit(settings) {
        if (!field) {
            return;
        }
        var text = (field.value || "").replace(/^\s+|\s+$/g, "");
        if (!text) {
            field.focus();
            return;
        }
        var send = function () {
            var s = settings || settingsOf();
            if (!s || !s.channelCode) {
                return;
            }
            request(
                triggerBase(s) + encodeURIComponent(s.channelCode) +
                "?head=" + encodeURIComponent(text) +
                "&avatar=" + encodeURIComponent(s.avatar || "") +
                "&url=" + encodeURIComponent(pageUrl())
            );
            if (field) {
                field.value = "";
                field.focus();
            }
        };
        var s = settings || settingsOf();
        // 通道码由组件按当前网址异步认领，点击图标时通常已就绪，没就绪就等一会儿
        if (s && s.channelCode) {
            send();
        } else if (s && typeof WebsitePusher.waitChannelCode === "function") {
            WebsitePusher.waitChannelCode(send);
        }
    }

    /* ---------- 输入框 ---------- */

    function closeBox(settings) {
        if (box && box.parentNode) {
            box.parentNode.removeChild(box);
        }
        box = null;
        field = null;
        var s = settings || settingsOf();
        // 与内核图标的状态保持一致：下次点击图标重新打开输入框
        if (s) {
            s.danMuSendOpened = false;
        }
    }

    function openBox(settings) {
        var existed = byId(BOX_ID);
        if (existed) {
            box = existed;
            field = existed.querySelector ? existed.querySelector(".dm-input-field") : null;
            if (field && field.focus) {
                field.focus();
            }
            return;
        }

        box = document.createElement("div");
        box.id = BOX_ID;
        box.className = "dm-input-box";

        field = document.createElement("input");
        field.type = "text";
        field.className = "dm-input-field";
        field.placeholder = t("danmuSendPlaceholder", "来发弹幕~");
        field.maxLength = MAX_LENGTH;

        var sendBtn = document.createElement("button");
        sendBtn.type = "button";
        sendBtn.className = "dm-input-send";
        sendBtn.textContent = t("danmuSend", "发送");

        var closeBtn = document.createElement("span");
        closeBtn.className = "dm-input-close";
        closeBtn.setAttribute("role", "button");
        closeBtn.setAttribute("aria-label", t("danmuSendCloseLabel", "关闭弹幕输入框"));
        closeBtn.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true">' +
            '<path d="M2 2l6 6M8 2l-6 6" fill="none" stroke="currentColor" ' +
            'stroke-width="1.4" stroke-linecap="round"/></svg>';

        bindEvent(field, "keydown", function (event) {
            var evt = event || window.event;
            var code = evt.keyCode || evt.which;
            if (code === 13 && !evt.isComposing) {
                if (evt.preventDefault) {
                    evt.preventDefault();
                }
                submit(settings);
            } else if (code === 27) {
                closeBox(settings);
            }
        });
        bindEvent(sendBtn, "click", function () {
            submit(settings);
        });
        bindEvent(closeBtn, "click", function () {
            closeBox(settings);
        });

        box.appendChild(field);
        box.appendChild(sendBtn);
        box.appendChild(closeBtn);
        (document.body || document.documentElement).appendChild(box);
        if (field.focus) {
            field.focus();
        }
    }

    /* ---------- 注册 ---------- */

    WebsitePusher.registerPlugin(NAME, function (settings) {
        if (!settings) {
            return;
        }
        injectCSS();
        if (hookedSettings === settings) {
            return;
        }
        hookedSettings = settings;

        // 包住宿主的 danMuSendOpen/Close：宿主自定义回调照常执行，输入框由插件负责
        var prevOpen = settings.danMuSendOpen;
        var prevClose = settings.danMuSendClose;

        settings.danMuSendOpen = function (s) {
            var target = s || settings;
            if (typeof prevOpen === "function") {
                try {
                    prevOpen.call(this, target);
                } catch (e) {
                    log(e);
                }
            }
            openBox(target);
        };
        settings.danMuSendClose = function (s) {
            if (typeof prevClose === "function") {
                try {
                    prevClose.call(this, s || settings);
                } catch (e) {
                    log(e);
                }
            }
            closeBox(s || settings);
        };
    });
})();
