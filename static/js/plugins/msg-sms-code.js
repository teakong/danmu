/**
 * msg-sms-code.js — 短信验证码识别并自动发送插件
 *
 * 【适用场景】（重要）
 *   1. 目前只支持 h5 挂件弹窗方式：页面需已加载 kf-pc.js / kf-pc.min.js（提供全局
 *      sendMsg(message) 方法），并由 pusher 的 new_msg 回调驱动。
 *      插件名以 msg 开头 → pusher 只订阅 new_msg（完整消息），不订阅 new_dm。
 *   2. 可以识别短信验证码：从消息正文（content / body / head）中提取短信验证码
 *      （参考各手机厂商从短信内容自动提取验证码的算法），提取成功后调用页面全局
 *      sendMsg(message) 方法，把验证码作为一条消息发送出去。
 *
 * 接入：
 *   insertNode.js?plugins=msg-sms-code.js&autoInit=0
 *   pc.html 自行读取 URL 参数后调用 WebsitePusher.init({... plugins:"msg-sms-code" ...})
 *
 * 验证码识别算法（参考手机厂商短信验证码提取）：
 *   1) 关键词定位：短信验证码 / 验证码为 / 验证码是 / 验证码 / 校验码 / 动态码 /
 *      动态密码 / 口令 / verification code / otp / code 等；
 *   2) 在关键词后 40 个字符内取第一个 4-8 位独立数字；
 *   3) 排除干扰：手机号(1[3-9]xxxxxxxxx)、年份(19xx/20xx)；
 *   4) 无关键词时兜底：正文中第一个合法的 4-6 位独立数字。
 *   示例正文「验证码为：363379。不要把验证码给任何人。」→ 提取 363379。
 *
 * 说明：
 *   - 与 msg-dialog 插件二选一（两者都写 settings.newMsgCallback，同时加载会互相覆盖）。
 *   - danMuMock 开关(默认0关闭): 由 init({danMuMock:1}) 传入, 不从URL读取; 开启后识别到验证码时,
 *     除调用全局 sendMsg(code) 外, 同时调用 WebsitePusher.sendDanMu({ info: code }) 在本地弹幕展示。
 *   - 严格 ES5（不用箭头函数/let-const），异常不影响 pusher 主流程。
 */
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) {
        return;
    }

    var NAME = "msg-sms-code";

    // 验证码关键词（按长度降序，优先匹配更具体的词组；大小写不敏感）
    var KEYWORDS =
        /(?:短信验证码|验证码为|验证码是|验证码|校验码|动态码|动态密码|随机码|口令|verification\s*code|passcode|otp|code)/gi;

    // 已处理的消息（按 messagePushId / messageId 去重，避免 socket 重连导致重复发送）
    var processed = {};
    // 已发送过的验证码去重: 自己发出的验证码会被服务端广播回 new_msg,
    // 回环消息每次都是新的 messagePushId, 单靠 processed 挡不住, 必须按验证码本身去重
    var sentCodes = {};

    /**
     * 判断候选数字是否为合法验证码
     */
    function isValidCode(num) {
        // 只取完整连续数字串后判长度：手机号(11位)等超长串直接排除，
        // 避免把 13800138000 贪婪截成前 8 位误当成验证码
        if (!num || num.length < 4 || num.length > 8) {
            return false;
        }
        // 手机号：1[3-9] 开头 11 位（长度已排除，双保险）
        if (/^1[3-9]\d{9}$/.test(num)) {
            return false;
        }
        // 年份：19xx / 20xx
        if (/^(?:19|20)\d{2}$/.test(num)) {
            return false;
        }
        return true;
    }

    /**
     * 从一段正文中提取验证码，识别不到返回空串
     */
    /**
     * 去掉 HTML 标签与颜色值。消息正文里的验证码常被 <font color=#0465d2> 之类
     * 高亮, 若不剥离, 颜色码里的 0465 会被误当成验证码。
     */
    function stripHtml(text) {
        return String(text)
            .replace(/<[^>]*>/g, "")       // 去掉所有 <...> 标签(含 style/color 属性)
            .replace(/#[0-9a-fA-F]{3,8}\b/g, "") // 兜底去掉残留的 #颜色值
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&");
    }

    function extractCode(text) {
        if (text == null) {
            return "";
        }
        // 必须在关键词定位之前清洗: after 的截图区间基于清洗后的下标,
        // 否则 <font color=#0465d2> 中的 0465 会先于真验证码被抓到。
        text = stripHtml(text);

        // 1) 关键词定位：关键词后 40 字符内第一个合法数字
        var m;
        KEYWORDS.lastIndex = 0;
        while ((m = KEYWORDS.exec(text)) !== null) {
            var after = text.substring(
                m.index + m[0].length,
                m.index + m[0].length + 40
            );
            var found = after.match(/\d+/);
            if (found && isValidCode(found[0])) {
                return found[0];
            }
        }

        // 2) 兜底：正文中第一个独立的 4-6 位数字（前后非数字，取完整串）
        var all = /(?:\D|^)(\d+)(?:\D|$)/g;
        var a;
        while ((a = all.exec(text)) !== null) {
            if (isValidCode(a[1])) {
                return a[1];
            }
        }
        return "";
    }

    WebsitePusher.registerPlugin(NAME, function (settings) {
        // danMuMock 开关(参考 stat 插件 statClick 的写法): 默认 0 关闭, init() 传 1 开启。
        // 只从 settings 读取, 不接受 URL 参数; 开启后识别到验证码会同时用本地弹幕展示。
        var danMuMock = settings && settings.danMuMock == 1;

        // message 是 pusher 解析好的对象（不再是 JSON 字符串）
        settings.newMsgCallback = function (message) {
            try {
                if (message == null || typeof message != "object") {
                    return;
                }

                // 去重
                var pid = message.messagePushId || message.messageId || "";
                if (pid && processed[pid]) {
                    return;
                }

                // 【防回环】忽略自己发出的消息: sendMsg 发出的 chatMessage 会被服务端
                // 广播回 new_msg, 若不过滤, 验证码会被再次识别→再次发送→无限循环。
                // 自己发出的消息 fromId/config.uid 一致; 客服/系统消息 uid 不同。
                var selfUid = (typeof config != "undefined" && config && config.uid) ? config.uid : "";
                var msgUid = message.fromId != null ? message.fromId : message.uid;
                if (selfUid && msgUid && String(msgUid) == String(selfUid)) {
                    return;
                }

                // 依次从 content / body / head 中识别（正文字段名因接入而异）
                var code = "";
                var sources = [message.content, message.body, message.head];
                for (var i = 0; i < sources.length; i++) {
                    code = extractCode(sources[i]);
                    if (code) {
                        break;
                    }
                }
                if (!code) {
                    return;
                }

                // 同一个验证码只发一次（兜底防回环 / 重连重复）
                if (sentCodes[code]) {
                    return;
                }
                sentCodes[code] = 1;

                if (pid) {
                    processed[pid] = 1;
                }

                // 调用页面全局 sendMsg(message) 方法（kf-pc.js），参数为纯验证码
                if (typeof window.sendMsg == "function") {
                    if (window.console) {
                        console.log("识别到短信验证码并发送：" + code);
                    }
                    window.sendMsg(code);
                } else if (window.console) {
                    console.log("识别到短信验证码：" + code + "（未找到 sendMsg 方法，未发送）");
                }

                // danMuMock=1 时, 把识别到的验证码同时通过本地弹幕展示(仅本地滚动, 不请求后端)
                if (danMuMock && typeof WebsitePusher.sendDanMu == "function") {
                    WebsitePusher.sendDanMu({ info: code });
                }
            } catch (e) {
                window.console && console.error(e);
            }
        };
    });
})();
