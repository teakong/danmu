/**
 * control.js — 左下角弹幕控制面板插件（plugins/ 目录内的官方插件）
 *
 * 接入（二选一）：
 *   <script src="//ws.phprm.com/static/customer/js/danmu.js?appName=xxx&channelCode=xxx&danMu=1&plugins=control"></script>
 *   WebsitePusher.init({ appName: "xxx", channelCode: "xxx", plugins: "control" });
 *
 * 行为：
 *   1) 左下角一个圆形齿轮按钮，点击展开/收起设置面板；
 *   2) 设置面板：不透明度(0~100) / 显示区域(10~100%) / 字号(8~33) / 弹幕速度(1~30)
 *      + 「弹幕」开关 + 恢复默认；滑块直接调用 WebsitePusher.updateDanMu / setDanMuArea；
 *   3) 开关状态写 localStorage.danmu_enabled（"1"=运行 / "0"=停止），与 danMuInitCallback 的约定一致，
 *      刷新页面后按它回显；恢复默认会把弹幕重新打开；
 *   4) 面板初始值取 settings.danMuSetting（默认 50 / 100 / 20 / 18），用户改过的值由组件自己持久化。
 *
 * 说明：
 *   - 图标（齿轮）内联在插件里，不额外请求图片，CDN 只同步 js 目录也不会出现空图标；
 *   - 严格 ES5、不依赖 jQuery，异常只打日志，不影响弹幕主流程；
 *   - 组件自身 UI 的点击不会被 stat 插件计入点击统计（.dm-float-wrap 已在 stat 的忽略列表里）。
 */
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) {
        return;
    }

    var NAME = "control";
    var CSS_ID = "danmu-control-css";
    var STORE_KEY = "danmu_enabled";

    // 多语言: 宿主页面提供 window.__t(push-front 的 shared.*.js)时用它, 缺字典时回退中文
    function t(key, fallback) {
        return typeof window.__t === "function" ? window.__t(key, fallback) : fallback;
    }

    // 面板默认值 = danMuSetting 的默认值；「恢复默认」就是把它们写回去
    var DEFAULTS = { opacity: 50, area: 100, size: 20, speed: 18 };
    // 速度滑块越大越快，实际飞行秒数 = 31 - 滑块值
    var SPEED_SUM = 31;

    var ICON_GEAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="3"></circle>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>' +
        '</svg>';

    var wrap = null;
    var refs = null;
    var state = { running: true };
    var docBound = false;

    function log(msg) {
        if (typeof console !== "undefined" && console.log) {
            console.log(msg);
        }
    }

    function isAttached(node) {
        if (!node) {
            return false;
        }
        if (document.body && document.body.contains) {
            return document.body.contains(node);
        }
        // IE8 兜底: 沿父链找 body
        var parent = node;
        while (parent) {
            if (parent === document.body) {
                return true;
            }
            parent = parent.parentNode;
        }
        return false;
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function intOr(value, def) {
        var num = parseInt(value, 10);
        return isNaN(num) ? def : num;
    }

    function clamp(num, min, max) {
        return num < min ? min : num > max ? max : num;
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

    /* ---------- 开关状态（localStorage 不可用时静默忽略，按开启处理） ---------- */

    function readRunning() {
        try {
            return window.localStorage.getItem(STORE_KEY) !== "0";
        } catch (e) {
            return true;
        }
    }

    function saveRunning(running) {
        try {
            window.localStorage.setItem(STORE_KEY, running ? "1" : "0");
        } catch (e) {
            // localStorage 被禁用(隐私模式等): 只在本次页面生效
        }
    }

    /* ---------- WebsitePusher 公开方法包装：组件未就绪时返回 false ---------- */

    function callApi(method) {
        if (!WebsitePusher || typeof WebsitePusher[method] !== "function") {
            return false;
        }
        try {
            return WebsitePusher[method]() !== false;
        } catch (e) {
            log(e);
            return false;
        }
    }

    function callUpdate(opts) {
        if (!WebsitePusher || typeof WebsitePusher.updateDanMu !== "function") {
            return false;
        }
        try {
            WebsitePusher.updateDanMu(opts);
            return true;
        } catch (e) {
            log(e);
            return false;
        }
    }

    function callArea(ratio) {
        if (!WebsitePusher || typeof WebsitePusher.setDanMuArea !== "function") {
            return false;
        }
        try {
            WebsitePusher.setDanMuArea(ratio);
            return true;
        } catch (e) {
            log(e);
            return false;
        }
    }

    /* ---------- 初始值 ---------- */

    function initialConfig(settings) {
        var cfg = settings && settings.danMuSetting ? settings.danMuSetting : {};
        return {
            opacity: clamp(intOr(cfg.opacity, DEFAULTS.opacity), 0, 100),
            area: DEFAULTS.area,
            size: clamp(intOr(cfg.size, DEFAULTS.size), 8, 33),
            speed: clamp(intOr(cfg.speed, DEFAULTS.speed), 1, 30)
        };
    }

    function sizeText(value) {
        var num = parseInt(value, 10);
        if (num <= 16) return t("danmuSizeS", "小");
        if (num <= 24) return t("danmuSizeM", "中");
        if (num <= 30) return t("danmuSizeL", "大");
        return t("danmuSizeXl", "超大");
    }

    function speedText(value) {
        var num = parseInt(value, 10);
        if (num <= 10) return t("danmuSpeedSlow", "慢");
        if (num <= 20) return t("danmuSpeedNormal", "正常");
        return t("danmuSpeedFast", "快");
    }

    /* ---------- 样式 ---------- */

    function injectCSS() {
        if (byId(CSS_ID)) {
            return;
        }
        var css = [
            ".dm-float-wrap { position: fixed; left: 16px; bottom: 16px; z-index: 2147483646; font-size: 13px; color: #1f1b2e; }",
            ".dm-float-btn {",
            "  width: 38px; height: 38px; padding: 0; border: 1px solid #d6d0ea; border-radius: 50%;",
            "  background: #fff; color: #0f766e; display: flex; align-items: center; justify-content: center;",
            "  cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.12); transition: transform .15s, box-shadow .2s;",
            "}",
            ".dm-float-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,.16); }",
            ".dm-float-btn:active { transform: scale(.94); }",
            ".dm-float-btn svg { width: 18px; height: 18px; display: block; }",
            ".dm-float-panel {",
            "  position: absolute; left: 0; bottom: calc(100% + 10px); width: 250px; box-sizing: border-box;",
            "  padding: 14px 16px; background: #fff; border: 1px solid #e8e5f0; border-radius: 12px;",
            "  box-shadow: 0 12px 32px rgba(0,0,0,.16); display: none;",
            "}",
            ".dm-float-panel.is-open { display: block; }",
            ".dm-row { margin-bottom: 12px; }",
            ".dm-row-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 12.5px; color: #4a4560; }",
            ".dm-row-label .dm-val { color: #1f1b2e; font-weight: 600; }",
            ".dm-slider {",
            "  -webkit-appearance: none; appearance: none; width: 100%; height: 4px; margin: 0;",
            "  border-radius: 2px; background: #d6d0ea; outline: none; cursor: pointer;",
            "}",
            ".dm-slider::-webkit-slider-thumb {",
            "  -webkit-appearance: none; appearance: none; width: 14px; height: 14px;",
            "  border: 2px solid #fff; border-radius: 50%; background: #0f766e;",
            "  box-shadow: 0 1px 4px rgba(0,0,0,.25); cursor: pointer;",
            "}",
            ".dm-slider::-moz-range-thumb {",
            "  width: 14px; height: 14px; border: 2px solid #fff; border-radius: 50%;",
            "  background: #0f766e; box-shadow: 0 1px 4px rgba(0,0,0,.25); cursor: pointer;",
            "}",
            ".dm-float-ai { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #4a4560; cursor: pointer; user-select: none; }",
            ".dm-float-ai input { width: 15px; height: 15px; margin: 0; accent-color: #0f766e; cursor: pointer; }",
            ".dm-reset-btn {",
            "  width: 100%; margin-top: 12px; padding: 7px 0; border: 1px solid #e8e5f0; border-radius: 8px;",
            "  background: #f4f2fa; color: #4a4560; font-size: 12.5px; cursor: pointer;",
            "}",
            ".dm-reset-btn:hover { color: #0f766e; border-color: #0f766e; }"
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

    /* ---------- DOM ---------- */

    function buildDOM() {
        wrap = document.createElement("div");
        wrap.className = "dm-float-wrap";
        /* 静态骨架，不含任何用户数据 */
        wrap.innerHTML =
            '<div class="dm-float-panel" id="dmPanel">' +
                '<div class="dm-row">' +
                    '<div class="dm-row-label"><span>' + t("danmuOpacity", "不透明度") + '</span><span class="dm-val" id="dmOpacityVal">50%</span></div>' +
                    '<input type="range" class="dm-slider" id="dmOpacity" min="0" max="100" step="1" value="50" />' +
                '</div>' +
                '<div class="dm-row">' +
                    '<div class="dm-row-label"><span>' + t("danmuArea", "显示区域") + '</span><span class="dm-val" id="dmAreaVal">100%</span></div>' +
                    '<input type="range" class="dm-slider" id="dmArea" min="10" max="100" step="10" value="100" />' +
                '</div>' +
                '<div class="dm-row">' +
                    '<div class="dm-row-label"><span>' + t("danmuSize", "字号") + '</span><span class="dm-val" id="dmSizeVal">' + t("danmuSizeM", "中") + '</span></div>' +
                    '<input type="range" class="dm-slider" id="dmSize" min="8" max="33" step="1" value="20" />' +
                '</div>' +
                '<div class="dm-row">' +
                    '<div class="dm-row-label"><span>' + t("danmuSpeedLabel", "弹幕速度") + '</span><span class="dm-val" id="dmSpeedVal">' + t("danmuSpeedNormal", "正常") + '</span></div>' +
                    '<input type="range" class="dm-slider" id="dmSpeed" min="1" max="30" step="1" value="13" />' +
                '</div>' +
                '<label class="dm-float-ai"><input type="checkbox" id="dmToggle" checked /> <span>' + t("danmuTitle", "弹幕") + '</span></label>' +
                '<button type="button" class="dm-reset-btn" id="dmReset">' + t("danmuReset", "恢复默认") + '</button>' +
            '</div>' +
            '<button type="button" class="dm-float-btn" id="dmSettings" title="' + t("danmuSettings", "弹幕设置") + '" aria-label="' + t("danmuSettings", "弹幕设置") + '" aria-expanded="false">' +
                ICON_GEAR +
            '</button>';
        (document.body || document.documentElement).appendChild(wrap);

        refs = {
            panel: byId("dmPanel"),
            config: byId("dmSettings"),
            toggle: byId("dmToggle"),
            opacity: byId("dmOpacity"),
            area: byId("dmArea"),
            size: byId("dmSize"),
            speed: byId("dmSpeed")
        };
    }

    function paintToggle() {
        refs.toggle.checked = state.running;
    }

    function setPanelOpen(open) {
        refs.panel.className = open ? "dm-float-panel is-open" : "dm-float-panel";
        refs.config.setAttribute("aria-expanded", open ? "true" : "false");
    }

    /* ---------- 交互 ---------- */

    function closePanel() {
        setPanelOpen(false);
    }

    function applyOpacity(value) {
        var num = clamp(intOr(value, DEFAULTS.opacity), 0, 100);
        byId("dmOpacityVal").textContent = num + "%";
        callUpdate({ opacity: num });
    }

    function applyArea(value) {
        var num = clamp(intOr(value, DEFAULTS.area), 10, 100);
        byId("dmAreaVal").textContent = num + "%";
        callArea(num / 100);
    }

    function applySize(value) {
        var num = clamp(intOr(value, DEFAULTS.size), 8, 33);
        byId("dmSizeVal").textContent = sizeText(num);
        callUpdate({ size: num });
    }

    function applySpeed(value) {
        var num = clamp(intOr(value, SPEED_SUM - DEFAULTS.speed), 1, 30);
        byId("dmSpeedVal").textContent = speedText(num);
        callUpdate({ speed: SPEED_SUM - num });
    }

    function onToggle() {
        if (refs.toggle.checked) {
            if (callApi("startDanMu")) {
                state.running = true;
                saveRunning(true);
            } else {
                refs.toggle.checked = false;
            }
            return;
        }
        if (callApi("stopDanMu")) {
            state.running = false;
            saveRunning(false);
        } else {
            refs.toggle.checked = true;
        }
    }

    function bindInput(input, apply) {
        var handler = function () {
            apply(input.value);
        };
        bindEvent(input, "input", handler);
        // IE8 只有 change；现代浏览器松手时还会再触发一次，apply 是幂等的
        bindEvent(input, "change", handler);
    }

    function bindDocument() {
        // destroy() 后重新 init 会重建面板，文档级监听只绑一次，用 wrap 实时判断
        if (docBound) {
            return;
        }
        docBound = true;
        // 点面板外关闭；ESC 也关
        bindEvent(document, "click", function (event) {
            if (!isAttached(wrap)) {
                return;
            }
            var target = event.target || event.srcElement;
            var inside = false;
            if (target) {
                if (wrap.contains) {
                    inside = wrap.contains(target);
                } else if (wrap.compareDocumentPosition) {
                    inside = !!(wrap.compareDocumentPosition(target) & 16);
                }
            }
            if (!inside) {
                closePanel();
            }
        });
        bindEvent(document, "keydown", function (event) {
            if (!isAttached(wrap)) {
                return;
            }
            var evt = event || window.event;
            if (evt && (evt.keyCode || evt.which) === 27) {
                closePanel();
            }
        });
    }

    function bindEvents() {
        bindEvent(refs.config, "click", function (event) {
            if (event && event.stopPropagation) {
                event.stopPropagation();
            }
            setPanelOpen(refs.panel.className.indexOf("is-open") === -1);
        });

        bindEvent(refs.toggle, "change", onToggle);

        bindDocument();

        bindInput(refs.opacity, applyOpacity);
        bindInput(refs.area, applyArea);
        bindInput(refs.size, applySize);
        bindInput(refs.speed, applySpeed);

        bindEvent(byId("dmReset"), "click", function () {
            refs.opacity.value = DEFAULTS.opacity;
            refs.area.value = DEFAULTS.area;
            refs.size.value = DEFAULTS.size;
            refs.speed.value = SPEED_SUM - DEFAULTS.speed;
            applyOpacity(DEFAULTS.opacity);
            applyArea(DEFAULTS.area);
            applySize(DEFAULTS.size);
            applySpeed(SPEED_SUM - DEFAULTS.speed);
            // 恢复默认同时把被关掉的弹幕重新打开
            refs.toggle.checked = true;
            onToggle();
        });
    }

    /* ---------- 初始化 ---------- */

    function init(settings) {
        injectCSS();
        buildDOM();

        var cfg = initialConfig(settings);
        state.running = readRunning();
        paintToggle();

        refs.opacity.value = cfg.opacity;
        refs.area.value = cfg.area;
        refs.size.value = cfg.size;
        refs.speed.value = SPEED_SUM - cfg.speed;
        byId("dmOpacityVal").textContent = cfg.opacity + "%";
        byId("dmAreaVal").textContent = cfg.area + "%";
        byId("dmSizeVal").textContent = sizeText(cfg.size);
        byId("dmSpeedVal").textContent = speedText(SPEED_SUM - cfg.speed);

        bindEvents();
    }

    function onReady(fn) {
        if (document.readyState === "loading") {
            if (document.addEventListener) {
                document.addEventListener("DOMContentLoaded", fn, false);
            } else if (document.attachEvent) {
                document.attachEvent("onreadystatechange", function () {
                    if (document.readyState === "complete") {
                        fn();
                    }
                });
            }
            return;
        }
        fn();
    }

    WebsitePusher.registerPlugin(NAME, function (settings) {
        // 同一页面重复 init 不重复建面板；destroy() 移除后重新 init 时重建
        if (isAttached(wrap)) {
            return;
        }
        wrap = null;
        refs = null;
        onReady(function () {
            init(settings);
        });
    });
})();
