/**
 * msg-dialog.js — 客服聊天窗口消息插件（配合 pc.html）
 *
 * 接入：
 *   insertNode.js?plugins=msg-dialog&autoInit=0
 *   pc.html 自行读取 URL 参数后调用 WebsitePusher.init({... plugins:"msg-dialog" ...})
 *
 * 原理：
 *   插件名以 msg 开头 → pusher 的 resolveStreamMode() 判定为 msg 模式 → 只订阅
 *   new_msg（完整消息），收到 JSON 解析后经 settings.newMsgCallback 交给本插件。
 *   服务端 login / danMuLogin 两种登录都会把连接加入同一房间，收到的是同一条
 *   new_msg，因此可完全替代旧版 pc.html 里自建 socketIO.on('new_msg') 的处理。
 *
 * 行为（与旧版 pc.html 的 new_msg 回调一致）：
 *   1) 通知栏打 data-id 并闪烁 10 次；
 *   2) showNewMessage(message) 顶部提示；
 *   3) uid 以 KF 开头时修正全局 kf_id / kf_name；
 *   4) content 是含 fromId/toId 的 JSON 时用 makeChatLog 渲染，自己发的消息跳过；
 *   5) 否则按普通消息 makeChatLog 追加到 #chat-list；
 *   6) messagePushId 去重。
 *
 * 说明：
 *   - 复用 pc.html 已加载的 kf.min.js / kf-pc.min.js 全局函数与变量
 *     (showNewMessage / makeChatLog / showBigPic / wordBottom / config / kf_id / kf_name)
 *   - 严格 ES5（不用箭头函数/let-const），异常不影响 pusher 主流程
 */
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) {
        return;
    }

    var NAME = "msg-dialog";

    // 每条 channelMemberRelId 的闪烁定时器，与原 pc.html 的 newMsgTimer 等价
    var newMsgTimer = new Array();

    WebsitePusher.registerPlugin(NAME, function (settings) {
        // message 已是 pusher 解析好的对象（不再是 JSON 字符串）
        settings.newMsgCallback = function (message) {
            if ("undefined" != typeof console) {
                console.log("收到新消息：" + JSON.stringify(message));
            }
            try {
                if (message == null || typeof message != "object") {
                    return;
                }
                var relId = message["channelMemberRelId"];
                var counter = 0;
                clearInterval(newMsgTimer[relId]);
                $(".notification").attr("data-id", relId);
                $(".notification #content").unbind("click").click(function () {
                    clearInterval(newMsgTimer[relId]);
                });
                newMsgTimer[relId] = setInterval(function () {
                    if (counter % 2 == 0) {
                        $(".notification").removeClass("sticky").addClass("sticky-blink");
                    } else {
                        $(".notification").removeClass("sticky-blink").addClass("sticky");
                    }
                    if (counter > 10) {
                        clearInterval(newMsgTimer[relId]);
                    }
                    counter++;
                }, 1000);

                if (typeof showNewMessage == "function") {
                    showNewMessage(message);
                }
                // 修正当前的 kf_id 和 kf_name
                if (message.uid && message.uid.indexOf("KF") == 0) {
                    kf_id = message.uid;
                    kf_name = message.name;
                }

                // 去重：该消息已渲染则跳过
                var id = message.messagePushId || "";
                if (id && $("#m-" + id).length > 0) {
                    return;
                }
                var item = {
                    id: message.messagePushId || "",
                    time: message.time || "",
                    fromId: message.uid,
                    toId: "",
                    fromAvatar: message.avatar || "",
                    fromName: message.name,
                    content: message.content
                };

                try {
                    var chatJson = JSON.parse(message.content);
                    if (chatJson && chatJson["fromId"] && chatJson["toId"]) {
                        // 自己发送的单聊、群聊消息不重复渲染
                        if (config.uid == chatJson["fromId"]) {
                            return;
                        }
                        $("#chat-list").append(makeChatLog(chatJson));
                        showBigPic();
                        wordBottom();
                        return;
                    }
                } catch (e) {}

                $("#chat-list").append(makeChatLog(item));
                showBigPic();
                wordBottom();
            } catch (e) {
                window.console && console.error(e);
            }
        };
    });
})();
