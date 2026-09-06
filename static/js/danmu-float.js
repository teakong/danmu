/**
 * danmu-float.js —— 左下角弹幕浮动控制组件
 *
 * 功能：
 *   1. 左侧"弹"图标：停止/启动弹幕（调用 WebsitePusher.stopDanMu / startDanMu）
 *   2. 右侧"A"图标：打开弹幕设置面板
 *      - 不透明度滑块 (0~100)  → updateDanMu({opacity})
 *      - 显示区域滑块 (10~100) → setDanMuArea(ratio)
 *      - 字体大小滑块 (8~33)   → updateDanMu({size})
 *      - 弹幕速度滑块          → updateDanMu({speed})
 *      - 屏蔽彩色弹幕开关      → MutationObserver 隐藏非白色弹幕
 *      - 恢复默认按钮          → 重置所有配置
 *
 * 使用：在 index.html 中通过 <script src="static/js/danmu-float.js"></script> 引入即可。
 * 依赖：jQuery、WebsitePusher（由 danmu.js 加载）。
 */
(function () {
    "use strict";

    /* ========== 默认配置 ========== */
    var DEFAULTS = {
        opacity: 50,
        area: 100,
        size: 20,
        speed: 18
    };

    /* ========== 工具函数 ========== */
    function callApi(method) {
        if (typeof WebsitePusher === "undefined" || typeof WebsitePusher[method] !== "function") {
            return false;
        }
        try {
            var result = WebsitePusher[method]();
            return result !== false;
        } catch (e) {
            console.error("WebsitePusher." + method + " 调用失败:", e);
            return false;
        }
    }

    function callApiUpdate(opts) {
        if (typeof WebsitePusher === "undefined" || typeof WebsitePusher.updateDanMu !== "function") {
            return false;
        }
        try {
            WebsitePusher.updateDanMu(opts);
            return true;
        } catch (e) {
            console.error("updateDanMu 调用失败:", e);
            return false;
        }
    }

    function callApiSetArea(ratio) {
        if (typeof WebsitePusher === "undefined" || typeof WebsitePusher.setDanMuArea !== "function") {
            return false;
        }
        try {
            WebsitePusher.setDanMuArea(ratio);
            return true;
        } catch (e) {
            console.error("setDanMuArea 调用失败:", e);
            return false;
        }
    }

    /* ========== 注入 CSS ========== */
    function injectCSS() {
        if (document.getElementById("danmu-float-css")) return;
        var css = [
            ".dm-float-wrap { position: fixed; left: 16px; bottom: 16px; z-index: 2147483646; display: flex; flex-direction: column; align-items: flex-start; }",
            ".dm-float-icons { display: flex; gap: 8px; }",
            ".dm-float-btn {",
            "  width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;",
            "  background: none;",
            "  display: flex; align-items: center; justify-content: center;",
            "  transition: transform .15s, opacity .2s;",
            "  padding: 0; user-select: none;",
            "}",
            ".dm-float-btn:hover { opacity: .85; }",
            ".dm-float-btn:active { transform: scale(.92); }",
            ".dm-float-btn img { width: 100%; height: 100%; display: block; }",
            ".dm-float-panel {",
            "  position: absolute; left: 0; bottom: calc(100% + 8px);",
            "  width: 280px; background: rgba(30,30,30,.8); color: #fff;",
            "  border-radius: 10px; padding: 16px 18px; box-shadow: 0 4px 20px rgba(0,0,0,.4);",
            "  display: none;",
            "}",
            ".dm-float-panel.is-open { display: block; }",
            ".dm-row { margin-bottom: 12px; }",
            ".dm-row:last-of-type { margin-bottom: 0; }",
            ".dm-row-label { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }",
            ".dm-row-label .dm-val { color: #fff; font-weight: bold; }",
            ".dm-slider {",
            "  -webkit-appearance: none; appearance: none; width: 100%; height: 4px;",
            "  background: rgba(255,255,255,.2); border-radius: 2px; outline: none;",
            "}",
            ".dm-slider::-webkit-slider-thumb {",
            "  -webkit-appearance: none; appearance: none; width: 14px; height: 14px;",
            "  border-radius: 50%; background: #4a90d9; cursor: pointer; border: 2px solid #fff;",
            "}",
            ".dm-slider::-moz-range-thumb {",
            "  width: 14px; height: 14px; border-radius: 50%; background: #4a90d9;",
            "  cursor: pointer; border: 2px solid #fff;",
            "}",
            ".dm-reset-btn {",
            "  width: 100%; margin-top: 14px; padding: 8px; border: 1px solid rgba(255,255,255,.25);",
            "  background: transparent; color: #fff; border-radius: 6px; cursor: pointer;",
            "  font-size: 13px; transition: all .2s;",
            "}",
            ".dm-reset-btn:hover { background: rgba(255,255,255,.1); color: #fff; }"
        ].join("\n");
        var style = document.createElement("style");
        style.id = "danmu-float-css";
        style.innerHTML = css;
        document.head.appendChild(style);
    }

    /* ========== 弹幕状态管理 ========== */
    var danmuState = {
        // 从 localStorage 读取上次的开关状态, "0"=关闭, 其他=开启(默认开启)
        running: localStorage.getItem("danmu_enabled") !== "0"
    };

    /* ========== 滑块值→文字映射 ========== */
    function sizeText(v) {
        v = parseInt(v, 10);
        if (v <= 16) return "小";
        if (v <= 24) return "中";
        if (v <= 30) return "大";
        return "超大";
    }

    function speedText(v) {
        v = parseInt(v, 10);
        if (v <= 10) return "慢";
        if (v <= 20) return "正常";
        return "快";
    }

    /* ========== 构建 DOM ========== */
    function buildDOM() {
        var wrap = document.createElement("div");
        wrap.className = "dm-float-wrap";
        wrap.innerHTML =
            '<div class="dm-float-panel" id="dmPanel">' +
                '<div class="dm-row">' +
                    '<div class="dm-row-label"><span>不透明度</span><span class="dm-val" id="dmOpacityVal">50%</span></div>' +
                    '<input type="range" class="dm-slider" id="dmOpacity" min="0" max="100" value="50" />' +
                '</div>' +
                '<div class="dm-row">' +
                    '<div class="dm-row-label"><span>显示区域</span><span class="dm-val" id="dmAreaVal">100%</span></div>' +
                    '<input type="range" class="dm-slider" id="dmArea" min="10" max="100" value="100" />' +
                '</div>' +
                '<div class="dm-row">' +
                    '<div class="dm-row-label"><span>字体大小</span><span class="dm-val" id="dmSizeVal">中</span></div>' +
                    '<input type="range" class="dm-slider" id="dmSize" min="8" max="33" value="20" />' +
                '</div>' +
                '<div class="dm-row">' +
                    '<div class="dm-row-label"><span>弹幕速度</span><span class="dm-val" id="dmSpeedVal">正常</span></div>' +
                    '<input type="range" class="dm-slider" id="dmSpeed" min="1" max="30" value="18" />' +
                '</div>' +
                '<button class="dm-reset-btn" id="dmReset">恢复默认</button>' +
            '</div>' +
            '<div class="dm-float-icons">' +
                '<button class="dm-float-btn" id="dmToggle" title="' + (danmuState.running ? "停止弹幕" : "启动弹幕") + '"><img src="static/css/images/' + (danmuState.running ? "dan-hover.svg" : "dan-close.svg") + '" alt="弹幕" /></button>' +
                '<button class="dm-float-btn" id="dmSettings" title="弹幕设置"><img src="static/css/images/dan-config.svg" alt="设置" /></button>' +
            '</div>';
        document.body.appendChild(wrap);
    }

    /* ========== 绑定事件 ========== */
    function bindEvents() {
        var $toggle = $("#dmToggle");
        var $settings = $("#dmSettings");
        var $panel = $("#dmPanel");

        $toggle.on("click", function () {
            var $img = $toggle.find("img");
            if (danmuState.running) {
                console.log("danmuState is running");
                if (callApi("stopDanMu")) {
                    danmuState.running = false;
                    localStorage.setItem("danmu_enabled", "0");
                    $img.attr("src", "static/css/images/dan-close.svg");
                    $toggle.attr("title", "启动弹幕");
                }
            } else {
                console.log("danmuState is not running");
                if (callApi("startDanMu")) {
                    danmuState.running = true;
                    localStorage.setItem("danmu_enabled", "1");
                    $img.attr("src", "static/css/images/dan-hover.svg");
                    $toggle.attr("title", "停止弹幕");
                }
            }
        });

        $settings.on("click", function (e) {
            e.stopPropagation();
            $panel.toggleClass("is-open");
        });

        $(document).on("click", function (e) {
            if (!$(e.target).closest(".dm-float-wrap").length) {
                $panel.removeClass("is-open");
            }
        });

        $("#dmOpacity").on("input", function () {
            var v = parseInt(this.value, 10);
            $("#dmOpacityVal").text(v + "%");
            callApiUpdate({ opacity: v });
        });

        $("#dmArea").on("input", function () {
            var v = parseInt(this.value, 10);
            $("#dmAreaVal").text(v + "%");
            callApiSetArea(v / 100);
        });

        $("#dmSize").on("input", function () {
            var v = parseInt(this.value, 10);
            $("#dmSizeVal").text(sizeText(v));
            callApiUpdate({ size: v });
        });

        $("#dmSpeed").on("input", function () {
            var v = parseInt(this.value, 10);
            $("#dmSpeedVal").text(speedText(v));
            callApiUpdate({ speed: 31 - v });
        });

        $("#dmReset").on("click", function () {
            $("#dmOpacity").val(DEFAULTS.opacity).trigger("input");
            $("#dmArea").val(DEFAULTS.area).trigger("input");
            $("#dmSize").val(DEFAULTS.size).trigger("input");
            $("#dmSpeed").val(DEFAULTS.speed).trigger("input");
        });
    }

    /* ========== 初始化 ========== */
    function init() {
        injectCSS();
        buildDOM();
        bindEvents();
    }

    function waitAndInit() {
        if (typeof jQuery !== "undefined") {
            init();
        } else {
            setTimeout(waitAndInit, 100);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", waitAndInit);
    } else {
        waitAndInit();
    }
})();
