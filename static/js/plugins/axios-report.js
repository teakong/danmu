/**
 * axios-report.js — axios 异常上报插件（pusher.js 的 plugins/ 目录内的官方插件）
 *
 * 接入：
 *   WebsitePusher.init({ plugins: "axios-report" })
 *   或 <script src="//ws.phprm.com/static/customer/js/danmu.js?appName=xxx&channelCode=xxx&plugins=axios-report"></script>
 * 行为：
 *   在 axios 的响应拦截器(interceptors.response)里捕获到异常时，向当前通道触发一条
 *   head=axios 的推送，body 为 JSON（异常信息/请求地址/响应状态/响应体片段），
 *   url 取当前页面地址（参考 push-h5/public/static/js/global.js 的上报思路）。
 *   通道后台的「推送记录」据此看到前端接口异常。
 *
 * 可选 settings（通过 WebsitePusher.init 传入，均有默认值）：
 *   axiosReportMax  本页最多上报条数，默认 10（对齐 global.js 的 maxSendNum）
 *
 * 说明：
 *   - axios 晚于本插件加载也生效：轮询 window.axios，最多等 15 秒
 *   - 只在拦截器里追加一个上报分支，仍然 return Promise.reject(error)，不改宿主请求链路
 *   - 超时/主动取消(ECONNABORTED、ERR_CANCELED、abort)不上报，避免刷屏
 *   - 同一份 body 本页只报一次；达到上限后只 console.warn，不再发请求
 *   - body 截断到 1000 字符，保持单条上报精简（上报已改 POST + JSON，不再受 URL 长度限制）；
 *     截断时优先丢响应体片段，尽量保持 body 仍是合法 JSON
 *   - 上报统一走 WebsitePusher.pushTrigger，通道码未认领时会先等它出现（最多 10 秒）
 *   - 不写 Cookie/localStorage，不做 DOM 操作，失败静默，不影响宿主页面
 */
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) {
        return;
    }

    var NAME = "axios-report";
    // body 长度上限：单条上报保持精简(上报走 POST + JSON, 不受 URL 长度限制)
    var MAX_BODY_LENGTH = 1000;
    // 本页上报条数上限，对齐 global.js 的 maxSendNum
    var MAX_SEND_NUM = 10;
    // axios 可能晚于插件加载（按需加载/CDN 异步），轮询等待
    var AXIOS_WAIT_INTERVAL = 200;
    var AXIOS_WAIT_TIMEOUT = 15000;

    // 拦截器是否已挂上：同一页面只挂一次
    var patched = false;
    // 已用上报配额：先占位再发请求，避免大量异常时挂出一堆等待通道码的轮询
    var sent = 0;
    // 已上报 body 的指纹，用于同页去重
    var seen = {};

    function log(msg) {
        if (typeof console != "undefined" && console.log) {
            console.log(msg);
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

    // 超时/主动取消类异常不上报（global.js 里也是先放过 ECONNABORTED）
    function isIgnored(error) {
        if (!error) {
            return true;
        }
        var code = safeText(error.code, 50);
        var msg = safeText(error.message, 300).toLowerCase();
        if (code == "ECONNABORTED" || code == "ERR_CANCELED") {
            return true;
        }
        if (
            msg.indexOf("abort") != -1 ||
            msg.indexOf("canceled") != -1 ||
            msg.indexOf("cancelled") != -1
        ) {
            return true;
        }
        return false;
    }

    // 组装 body(JSON 字符串)：异常信息 + 请求信息 + 响应信息
    function buildBody(error) {
        var body = {
            type: "axios",
            message: "",
            code: "",
            stack: "",
            method: "",
            requestUrl: "",
            status: 0,
            statusText: "",
            responseData: ""
        };
        if (error && typeof error == "object") {
            body.message = safeText(error.message, 300);
            body.code = safeText(error.code, 50);
            body.stack = safeText(error.stack, 300);
            var config = error.config || (error.response && error.response.config) || {};
            body.method = safeText(config.method, 20);
            body.requestUrl = safeText(config.url, 300);
            var response = error.response;
            if (response) {
                body.status = response.status || 0;
                body.statusText = safeText(response.statusText, 100);
                // 响应体片段：可能很长也可能含大对象，先截到 500
                body.responseData = safeText(response.data, 500);
            }
        } else {
            // 抛出的不是 Error 对象（字符串/数字等）
            body.message = safeText(error, 300);
        }

        var text = safeText(body, 0);
        // 超长时优先丢掉响应体片段，保证 body 仍是合法 JSON
        if (text.length > MAX_BODY_LENGTH) {
            body.responseData = "";
            text = safeText(body, 0);
        }
        if (text.length > MAX_BODY_LENGTH) {
            body.message = safeText(body.message, 200);
            body.stack = "";
            body.requestUrl = safeText(body.requestUrl, 150);
            text = safeText(body, 0);
        }
        // 兜底：极端情况下仍然超长，直接截断（可能不再是合法 JSON）
        if (text.length > MAX_BODY_LENGTH) {
            text = text.substring(0, MAX_BODY_LENGTH);
        }
        return text;
    }

    // 取本页上报上限：settings.axiosReportMax 可选覆盖，非法值回退默认
    function getMaxNum(settings) {
        if (settings && settings.axiosReportMax != null) {
            var num = parseInt(settings.axiosReportMax, 10);
            if (!isNaN(num) && num >= 0) {
                return num;
            }
        }
        return MAX_SEND_NUM;
    }

    // 一条异常上报
    function report(settings, error) {
        if (isIgnored(error)) {
            return;
        }
        var max = getMaxNum(settings);
        if (max <= 0) {
            return;
        }
        if (sent >= max) {
            log("axios-report 插件：本页上报已达上限(" + max + ")，忽略后续异常");
            return;
        }
        var body = buildBody(error);
        var fp = fingerprint(body);
        if (seen[fp]) {
            return;
        }
        seen[fp] = true;
        // 先占配额再发请求：避免发请求失败/等不到通道码时异常量放大轮询
        sent++;
        WebsitePusher.pushTrigger("axios", body, function (ok) {
            if (!ok) {
                log("axios-report 插件：上报失败(通道码未就绪或网络异常)，本次丢弃");
            }
        });
    }

    // 挂响应拦截器；已挂过或 axios 形态不对时返回 false
    function patch(axios, settings) {
        if (patched) {
            return true;
        }
        if (
            !axios ||
            !axios.interceptors ||
            !axios.interceptors.response ||
            typeof axios.interceptors.response.use != "function"
        ) {
            return false;
        }
        patched = true;
        axios.interceptors.response.use(
            function (response) {
                // 正常响应原样放行，不碰宿主数据
                return response;
            },
            function (error) {
                report(settings, error);
                // 与 global.js 一致：上报后继续把异常抛给宿主，不改宿主的错误处理
                return Promise.reject(error);
            }
        );
        return true;
    }

    // 轮询等 window.axios 出现并挂上拦截器
    function waitForAxios(settings) {
        var waited = 0;
        var tick = function () {
            if (patched) {
                return;
            }
            if (patch(window.axios, settings)) {
                return;
            }
            waited += AXIOS_WAIT_INTERVAL;
            if (waited >= AXIOS_WAIT_TIMEOUT) {
                log("axios-report 插件：等待 window.axios 超时，本次未挂拦截器");
                return;
            }
            window.setTimeout(tick, AXIOS_WAIT_INTERVAL);
        };
        tick();
    }

    WebsitePusher.registerPlugin(NAME, function (settings) {
        if (!settings) {
            log("axios-report 插件：缺少 settings，跳过异常上报");
            return;
        }
        waitForAxios(settings);
    });
})();
