/**
 * vue-report.js — Vue 异常上报插件（pusher.js 的 plugins/ 目录内的官方插件）
 *
 * 接入：
 *   WebsitePusher.init({ plugins: "vue-report" })
 *   或 <script src="//ws.phprm.com/static/customer/js/danmu.js?appName=xxx&channelCode=xxx&plugins=vue-report"></script>
 * 行为：
 *   捕获 Vue 渲染/生命周期/ watcher 里的异常与开发环境警告，向当前通道触发一条
 *   head=vue 的推送，body 为 JSON（异常类型/信息/堆栈/组件名/Vue 版本），
 *   url 取当前页面地址（参考 push-h5/public/static/js/global.js 的 reportVueHandler）。
 *
 * 兼容 Vue 2 / 3 / 4：
 *   - Vue 2：错误处理挂在全局 Vue.config 上，直接接管 Vue.config.errorHandler / warnHandler
 *   - Vue 3、Vue 4：错误处理挂在每个 app.config 上，包装 Vue.createApp，
 *     对返回的 app.config 做同样的接管
 *   - 版本判断不靠写死版本号，按能力探测（有 createApp 按 3/4 处理，否则按 2 处理）
 *   - 接管是链式的：保存宿主原有 handler 并继续调用，注入顺序不影响宿主行为
 *
 * 可选 settings（通过 WebsitePusher.init 传入，均有默认值）：
 *   vueReportMax        本页最多上报条数，默认 10
 *   vueReportWarn       0=不上报警告(默认 1=上报 errorHandler + warnHandler)
 *
 * 说明：
 *   - Vue 晚于本插件加载也生效：轮询 window.Vue，最多等 15 秒
 *   - 只上报，不吞异常：原 handler 照常执行，没有原 handler 时用 console.error 输出
 *   - 同一份 body 本页只报一次；达到上限后只 console.warn，不再发请求
 *   - body 截断到 1000 字符，保持单条上报精简（上报已改 POST + JSON，不再受 URL 长度限制）
 *   - 上报统一走 WebsitePusher.pushTrigger，通道码未认领时会先等它出现（最多 10 秒）
 *   - 不写 Cookie/localStorage，不做 DOM 操作，失败静默，不影响宿主页面
 */
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) {
        return;
    }

    var NAME = "vue-report";
    // body 长度上限：单条上报保持精简(上报走 POST + JSON, 不受 URL 长度限制)
    var MAX_BODY_LENGTH = 1000;
    // 本页上报条数上限
    var MAX_SEND_NUM = 10;
    // Vue 可能晚于插件加载，轮询等待
    var VUE_WAIT_INTERVAL = 200;
    var VUE_WAIT_TIMEOUT = 15000;

    // 已用上报配额：先占位再发请求，避免大量异常时挂出一堆等待通道码的轮询
    var sent = 0;
    // 已上报 body 的指纹，用于同页去重
    var seen = {};
    // 已接管过的 Vue 全局对象（同一页面可能 init 多次）
    var patchedVue = null;

    function log(msg) {
        if (typeof console != "undefined" && console.log) {
            console.log(msg);
        }
    }

    function warn(msg) {
        if (typeof console != "undefined") {
            if (console.warn) {
                console.warn(msg);
            } else if (console.log) {
                console.log(msg);
            }
        }
    }

    // 任意值转字符串；对象走 JSON.stringify，循环引用等序列化失败时退化为 String
    function safeText(value, max) {
        if (value == null || value === "") {
            return "";
        }
        var text;
        try {
            text = typeof value == "string" ? value : JSON.stringify(value);
        } catch (e) {
            text = String(value);
        }
        if (!text) {
            return "";
        }
        if (max && text.length > max) {
            text = text.substring(0, max);
        }
        return text;
    }

    // body 去重用的轻量指纹：整串太短就全量比较，太长取长度+首尾片段
    function fingerprint(text) {
        if (text.length <= 64) {
            return text;
        }
        return text.length + "|" + text.substring(0, 32) + "|" + text.substring(text.length - 32);
    }

    // Vue 的版本号串：body 里带上，方便区分 2/3/4 的异常形态
    function getVueVersion(vm) {
        if (vm && vm.version) {
            return safeText(vm.version, 30);
        }
        if (patchedVue && patchedVue.version) {
            return safeText(patchedVue.version, 30);
        }
        return "";
    }

    // 组件名：Vue2 在 $options.name/_componentTag，Vue3/4 在实例 type.name/__name
    function pickName(source) {
        if (!source) {
            return "";
        }
        return source.name || source.__name || source._componentTag || "";
    }

    function getComponentName(vm) {
        if (!vm) {
            return "";
        }
        var name = "";
        try {
            if (vm.$ && vm.$.type) {
                // Vue3/4 的公共实例代理：$ 为内部实例(type 一定存在)，不会触发 Vue 警告
                name = pickName(vm.$.type);
                if (!name && vm.$.root === vm.$) {
                    name = "Root";
                }
            } else {
                // Vue2 实例：组件名在 $options 上，根实例用 $root === vm 判断
                name = pickName(vm.$options) || pickName(vm.type);
                if (!name && vm.$root === vm) {
                    name = "Root";
                }
            }
        } catch (e) {}
        return name ? safeText(name, 100) : "";
    }

    // 组装 body(JSON 字符串)
    function buildBody(kind, err, vm, info) {
        var body = {
            type: "vue",
            kind: kind,
            vueVersion: getVueVersion(vm),
            message: "",
            stack: "",
            info: "",
            component: ""
        };
        if (kind == "warn") {
            // Vue2/3 的 warnHandler 入参是 (msg, vm, trace)
            body.message = safeText(err, 300);
            body.stack = safeText(info, 400);
        } else {
            // errorHandler 入参是 (err, vm, info)
            body.message = safeText(err && err.message ? err.message : err, 300);
            body.stack = safeText(err && err.stack, 400);
            body.info = safeText(info, 200);
        }
        body.component = getComponentName(vm);

        var text = safeText(body, 0);
        // 超长时按优先级逐步瘦身，尽量保持 body 仍是合法 JSON
        if (text.length > MAX_BODY_LENGTH) {
            body.stack = safeText(body.stack, 200);
            text = safeText(body, 0);
        }
        if (text.length > MAX_BODY_LENGTH) {
            body.stack = "";
            body.info = "";
            body.message = safeText(body.message, 200);
            text = safeText(body, 0);
        }
        if (text.length > MAX_BODY_LENGTH) {
            text = text.substring(0, MAX_BODY_LENGTH);
        }
        return text;
    }

    // 取本页上报上限：settings.vueReportMax 可选覆盖，非法值回退默认
    function getMaxNum(settings) {
        if (settings && settings.vueReportMax != null) {
            var num = parseInt(settings.vueReportMax, 10);
            if (!isNaN(num) && num >= 0) {
                return num;
            }
        }
        return MAX_SEND_NUM;
    }

    // 一条 Vue 异常上报
    function report(settings, kind, err, vm, info) {
        var max = getMaxNum(settings);
        if (max <= 0) {
            return;
        }
        if (sent >= max) {
            warn("vue-report 插件：本页上报已达上限(" + max + ")，忽略后续异常");
            return;
        }
        var body = buildBody(kind, err, vm, info);
        var fp = fingerprint(body);
        if (seen[fp]) {
            return;
        }
        seen[fp] = true;
        // 先占配额再发请求：避免发请求失败/等不到通道码时异常量放大轮询
        sent++;
        WebsitePusher.pushTrigger("vue", body, function (ok) {
            if (!ok) {
                log("vue-report 插件：上报失败(通道码未就绪或网络异常)，本次丢弃");
            }
        });
    }

    // 原 handler 不存在时保持默认控制台输出，方便本地调试
    function defaultHandler(kind) {
        if (typeof console != "undefined" && console.error) {
            return function (err) {
                console.error(err);
            };
        }
        return function () {};
    }

    /**
     * 接管 config 上的 errorHandler / warnHandler：
     * 先上报，再调用宿主原有 handler（链式，不覆盖宿主行为）
     */
    function chainHandler(config, key, kind, settings) {
        var origin = config[key];
        config[key] = function (a, b, c) {
            report(settings, kind, a, b, c);
            if (typeof origin == "function") {
                try {
                    return origin.apply(this, arguments);
                } catch (e) {
                    log("vue-report 插件：原 " + key + " 执行异常");
                }
                return;
            }
            if (kind == "warn") {
                warn(a);
            } else {
                defaultHandler(kind)(a);
            }
        };
    }

    // 接管一个 config（Vue2 的 Vue.config 或 Vue3/4 的 app.config），只接管一次
    function patchConfig(config, settings) {
        if (!config || config.__vueReportPatched) {
            return false;
        }
        config.__vueReportPatched = true;
        chainHandler(config, "errorHandler", "error", settings);
        if (settings.vueReportWarn != 0) {
            chainHandler(config, "warnHandler", "warn", settings);
        }
        return true;
    }

    // 包装 Vue.createApp：Vue3/4 的错误处理挂在每个 app 的 config 上
    function patchCreateApp(Vue, settings) {
        if (Vue.__vueReportCreateAppPatched || typeof Vue.createApp != "function") {
            return;
        }
        var originCreateApp = Vue.createApp;
        Vue.__vueReportCreateAppPatched = true;
        Vue.createApp = function () {
            var app = originCreateApp.apply(this, arguments);
            try {
                if (app && app.config) {
                    patchConfig(app.config, settings);
                }
            } catch (e) {
                log("vue-report 插件：接管 app.config 失败");
            }
            return app;
        };
    }

    // 按能力探测接管 Vue：有 createApp 走 3/4，否则走 2
    function patchVue(Vue, settings) {
        if (!Vue || patchedVue) {
            return !!patchedVue;
        }
        var isV3 = typeof Vue.createApp == "function";
        if (isV3) {
            patchCreateApp(Vue, settings);
        } else if (Vue.config) {
            // Vue2：全局 config 直接生效
            patchConfig(Vue.config, settings);
        } else {
            return false;
        }
        patchedVue = Vue;
        return true;
    }

    // 轮询等 window.Vue 出现并接管
    function waitForVue(settings) {
        var waited = 0;
        var tick = function () {
            if (patchedVue) {
                return;
            }
            if (patchVue(window.Vue, settings)) {
                return;
            }
            waited += VUE_WAIT_INTERVAL;
            if (waited >= VUE_WAIT_TIMEOUT) {
                log("vue-report 插件：等待 window.Vue 超时，本次未接管");
                return;
            }
            window.setTimeout(tick, VUE_WAIT_INTERVAL);
        };
        tick();
    }

    WebsitePusher.registerPlugin(NAME, function (settings) {
        if (!settings) {
            log("vue-report 插件：缺少 settings，跳过异常上报");
            return;
        }
        waitForVue(settings);
    });
})();
