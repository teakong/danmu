/**
 * WebsitePusher —— 一封传话聚合推送 + 弹幕 组件（单文件 IIFE，依赖 jQuery）。
 *
 * 接入入口：
 *   WebsitePusher.init(options)
 *     options 为 settings 的覆盖项；未传字段沿用默认值，嵌套对象(如 danMuSetting)按字段
 *     深合并。URL 参数 appName/device/clientVersion/screenResolution 会覆盖同名 setting。
 *
 * settings（外部契约，key 不可变更）：
 *   基础配置：siteName / apiKey / cssSite(iframe内CSS基础路径) /
 *             jsSite(JS/layui资源基础路径) /
 *             pcUrl / pushUrl / apiUrl / authUrl /
 *             wsUrl(socket.io地址) / channelMemberUrl(打开推送通道) / appName /
 *             closeText(弹幕关闭按钮自定义文案)
 *   用户态：  channelCode / uid / name / createTime / token / avatar / device /
 *             clientVersion / screenResolution / userPlatformType / userPlatformVersion
 *   行为开关：hideDialog(0/1) / hidePanel(0/1) / danMu(0/1)
 *   弹幕运行时控制（供外部开发者动态开关弹幕）：
 *     WebsitePusher.stopDanMu()   停止弹幕：断开Socket.IO、停AI轮询、清屏，保留token/doc供恢复
 *     WebsitePusher.startDanMu()  启动弹幕：重连Socket.IO、重启AI轮询(依赖stopDanMu前保存的上下文)
 *     WebsitePusher.updateDanMu(options)  更新弹幕配置并立即生效(外观/AI轮询), options为danMuSetting字段子集
 *     WebsitePusher.hideDanMu()          隐藏弹幕(visibility:hidden, 动画继续不丢消息)
 *     WebsitePusher.showDanMu()          显示弹幕(移除hideDanMu的隐藏样式)
 *     WebsitePusher.pauseDanMu()         暂停弹幕(冻结滚动, 新消息暂存队列)
 *     WebsitePusher.resumeDanMu()        恢复弹幕(重启滚动, 刷新暂存队列)
 *     WebsitePusher.setDanMuArea(ratio)   设置显示区域比例(0.1~1, 如0.5=上半屏)
 *     WebsitePusher.clearDanMu()          清屏(移除所有弹幕元素+清空暂停队列, 不影响连接)
 *   弹幕配置：danMuSetting{
 *       外观   opacity(0~100, 背景alpha=值/100) / size(8~33,字号) / speed(飞行秒数) /
 *              color(文字与省略号颜色) / bottom(底部偏移px)
 *       开关   close(0/1,关闭按钮) / like(0/1,点赞❤) / selector(弹幕挂载容器选择器,默认body)
 *       AI弹幕 aiDanMu(轮询秒数,0=关; 控制面板的"AI开关+间隔"表单只作UI, 保存时合并写回本字段) /
 *              aiDanMuUrl(AI弹幕接口,空则回退apiUrl) / bottomradio(表单固定底部开关)
 *   }
 *   回调钩子（均为 settings 属性，内部以 this.settings.xxx 调用，回调内 this 指向 settings）：
 *     configCallback(params)             -> boolean 打开客服窗口前的拦截，false 则不打开
 *     danMuInitCallback(settings)        -> boolean 弹幕初始化闸门，false 则禁用弹幕
 *     danMuSendOpen(settings)            -> any     右下角弹幕图标首次点击时触发(开启弹幕发送)
 *     danMuSendClose(settings)           -> any     右下角弹幕图标再次点击时触发(关闭弹幕发送)
 *     danMuFilter(item)                  -> any     每条弹幕分发入口（默认走过滤链）
 *     danMuFilterCallback(item, cb)      -> any     按 item.id 去重 + info 非空校验，通过后
 *                                                   先回调 cb(selector, item) 让调用方设置
 *                                                   item.onAction 等字段, 再执行
 *                                                   $(danMuSetting.selector).barrager(item)
 *     danMuPopCallback(dom, item)        -> any     弹幕挂载后回调，默认给 item 绑定
 *                                                   onAction(barrage, action)，action='close'|'like'|'unlike'
 *     checkAiDanMu(doc, pollCount)  -> any     AI弹幕轮询入口（内部经 WebsitePusher 单例
 *                                                   访问状态与工具方法，重写时建议同样处理）；
 *                                                   pollCount 为当前第N次轮询, 首次调用不传默认1,
 *                                                   随 params.pollCount 上报后端
 *
 * 弹幕分发链路（一条消息的完整流程）：
 *   后端消息 -> buildBarragerItem(套用danMuSetting默认值) -> danMuFilter -> danMuFilterCallback(去重/校验)
 *   -> danMuPopCallback(设置onAction) -> $(selector).barrager(item) 渲染 -> 交互走 jquery.barrager.js
 *
 * 持久化：
 *   appKey       服务端鉴权契约，随 withCredentials 发送，勿改名
 *   danMuConfig  弹幕表单配置 JSON（localStorage，key=pusher_danmu_config，客户端；
 *               localStorage不可用时自动回退cookie, 兼容IE6/7及file://等异常环境）
 *
 * 兼容：严格 ES5，支持 IE / GBK 页面。
 *
 * 公开方法：
 *   init(settings)       初始化弹幕/客服系统
 *   destroy()           销毁所有资源(DOM/事件/Socket.IO/定时器/缓存), 销毁后可重新 init
 *   stopDanMu()         停止弹幕(断开 Socket.IO, 保留 token 供恢复)
 *   startDanMu()        启动弹幕(恢复 Socket.IO, 依赖 stopDanMu 前保存的 token)
 *   sendDanMu(item)     主动发送一条弹幕(仅本地滚动, 不请求业务方后端)
 *   updateDanMu(opts)   更新弹幕配置并立即生效
 *   setDanMuArea(ratio) 设置弹幕显示区域比例
 */
try {
    /* ===== 0-1. 全局兜底: 清除泄漏的 layui-layer-move 遮罩 (layui layer 拖动中鼠标在窗口外松开时遮罩不清理) ===== */
    (function () {
        // 清理函数: 若检测到 .layui-layer-move 泄漏 (当前鼠标未按下 + 延迟 300ms 仍然存在), 直接删除 DOM
        var timer = null;
        function removeLayerMove() {
            $(".layui-layer-move").each(function () {
                try {
                    this.parentNode && this.parentNode.removeChild(this);
                } catch (e) {}
            });
        }
        function tryClear(e) {
            if (!$(".layui-layer-move").length) return;
            // event.buttons 存在时: bit1 为 1 表示左键正按下 (真正在拖动), 不清理
            var pressing = e && typeof e.buttons === "number" ? e.buttons & 1 : 0;
            if (pressing) return;
            // 鼠标已松开 → 延迟 300ms 后再删 (避免真正的拖动中 mousemove 短暂出现 buttons=0 的误删)
            if (timer) return;
            timer = setTimeout(function () {
                timer = null;
                removeLayerMove();
            }, 300);
        }
        // 任意用户交互事件均触发检查 (覆盖: 拖出窗口外松开后回来、Alt-Tab 回窗口、点击、滚动等)
        $(document).on(
            "mouseup mousemove click dblclick focusin keydown mouseenter mouseover",
            tryClear,
        );
        $(window).on("blur focus resize scroll", tryClear);
        // 失焦/最小化时如果存在 move 遮罩 → 立即删 (离开页面不可能还在拖动)
        $(window).on("blur visibilitychange pagehide", function () {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            removeLayerMove();
        });
    })();

    /* ===== 0. bg_move：可拖拽 / 可缩放 / 吸边（edge-snap）面板插件，挂到 jQuery.fn.bg_move ===== */
    (function () {
        function b(t, s) {
            this.t = t;
            this.opts = s;
            this.c = t.find(s.move).first();
            this.cs = t.find(s.closed).first();
            this.m = false;
            this.s = false;
            this.hide = 5;
            this.size_bg = s.size;
            this.init();
        }
        b.prototype = {
            init: function () {
                var t = this;
                t.box_sizing = t.t.css("box-sizing");
                t.top = t.t.offset().top - $(window).scrollTop();
                t.left = t.t.offset().left - $(window).scrollLeft();
                t.height = t.t.outerHeight();
                t.width = t.t.outerWidth();
                t.w_width = $(window).width();
                t.w_height = $(window).height();
                if (t.box_sizing != "border-box") {
                    t.c_width = t.width - t.t.width();
                    t.c_height = t.height - t.t.height();
                } else {
                    t.c_width = 0;
                    t.c_height = 0;
                }
                t.t.css({
                    "max-height": t.w_height - t.c_height,
                    "max-width": t.w_width - t.c_width,
                    position: "fixed",
                });
                $(window).resize(function () {
                    t.w_width = $(window).width();
                    t.w_height = $(window).height();
                    if (t.box_sizing != "border-box") {
                        t.c_width = t.width - t.t.width();
                        t.c_height = t.height - t.t.height();
                    } else {
                        t.c_width = 0;
                        t.c_height = 0;
                    }
                    if (t.t.width() > t.w_width - t.c_width) {
                        t.t.width(t.w_width - t.c_width);
                    }
                    if (t.t.height() > t.w_height - t.c_height) {
                        t.t.height(t.w_height - t.c_height);
                    }
                    t.t.css({
                        "max-height": t.w_height - t.c_height,
                        "max-width": t.w_width - t.c_width,
                    });
                    t.height = t.t.outerHeight();
                    t.width = t.t.outerWidth();
                    if (t.width + t.left >= t.w_width) {
                        t.left = t.w_width - t.width;
                        if (parseInt(t.t.css("left")) < 0) {
                            t.t.css("left", -t.width + t.hide);
                        } else if (parseInt(t.t.css("left")) > t.w_width - t.width) {
                            t.t.css("left", t.w_width - t.hide);
                        } else {
                            t.t.css("left", t.left);
                        }
                    }
                    if (t.height + t.top >= t.w_height) {
                        t.top = t.w_height - t.height;
                        if (parseInt(t.t.css("top")) < 0) {
                            t.t.css("top", -t.height + t.hide);
                        } else {
                            t.t.css("top", t.top);
                        }
                    }
                });
                t.move();
                t.size();
            },
            move: function () {
                var t = this;
                t.cs.on("mousedown", function (e) {
                    // 阻止拖动传播（点关闭按钮不触发面板位置变化）
                    e.stopPropagation();
                    // 优先调用外部传入的关闭回调；无回调时保持原有吸顶行为（向后兼容）
                    if (typeof t.opts.onClosed === "function") {
                        try {
                            t.opts.onClosed(t.t);
                        } catch (e) {}
                    } else {
                        t.top = 0;
                        t.right = 0;
                        t.t.animate({ top: 0, right: 0 }, 300, function () {
                            t.top_animate();
                        });
                    }
                    return false;
                });
                t.c.on("mousedown", function (e) {
                    t.m = true;
                    t.x = e.pageX;
                    t.y = e.pageY;
                    t.height = t.t.outerHeight();
                    t.width = t.t.outerWidth();
                    // 拖动期间禁用 iframe 指针事件，避免 iframe 吞掉 mousemove 导致拖动卡顿
                    t.t.find("iframe").css("pointer-events", "none");
                    var onMove = function (e) {
                        t.left2 = t.left + e.pageX - t.x;
                        t.top2 = t.top + e.pageY - t.y;
                        if (t.left2 <= 0) {
                            t.left2 = 0;
                        } else if (t.left2 >= t.w_width - t.width) {
                            t.left2 = t.w_width - t.width;
                        }
                        if (t.top2 <= 0) {
                            t.top2 = 0;
                        } else if (t.top2 >= t.w_height - t.height) {
                            t.top2 = t.w_height - t.height;
                        }
                        t.t.css({ top: t.top2, left: t.left2 });
                        return false;
                    };
                    var endMove = function (ev) {
                        if (!t.m) return; // 兜底事件可能多次触发, 只清一次
                        var pageX =
                            ev && typeof ev.pageX === "number" ? ev.pageX : t.x + t.left;
                        var pageY =
                            ev && typeof ev.pageY === "number" ? ev.pageY : t.y + t.top;
                        t.top = t.t.offset().top - $(window).scrollTop();
                        t.left = t.t.offset().left - $(window).scrollLeft();
                        if (t.top == 0 && t.leave(pageX, pageY)) {
                            t.top_animate();
                        } else if (t.left == 0 && t.leave(pageX, pageY)) {
                            t.left_animate();
                        } else if (t.left == t.w_width - t.width && t.leave(pageX, pageY)) {
                            t.right_animate();
                        }
                        t.t.find("iframe").css("pointer-events", "");
                        $(document).off("mousemove", onMove);
                        $(document).off("mouseup", endMove);
                        $(window).off("blur", endMove);
                        $(document).off("mouseleave", endMove);
                        $(window).off("pointercancel", endMove);
                        t.m = false;
                    };
                    $(document).on("mousemove", onMove);
                    $(document).on("mouseup", endMove);
                    // 兜底: 拖动中鼠标离开浏览器窗口再松开 / Alt-Tab 切走 / 指针取消 (触屏/触控板) → 一律结束拖动
                    $(window).on("blur", endMove);
                    $(document).on("mouseleave", endMove);
                    $(window).on("pointercancel", endMove);
                    return false;
                });
                t.t.on("mouseleave", function () {
                    if (!t.t.is(":animated") && !t.m && !t.s) {
                        if (t.top == 0) {
                            t.top_animate();
                        } else if (t.left == 0) {
                            t.left_animate();
                        } else if (t.left == t.w_width - t.width) {
                            t.right_animate();
                        }
                    }
                });
            },
            size: function () {
                var t = this;
                t.t.append('<span class="bg_change_size">&nbsp;</span>');
                t.sz = t.t.find(".bg_change_size").first();
                t.sz.css({
                    position: "absolute",
                    right: 0,
                    bottom: 0,
                    display: "block",
                    width: t.size_bg + "px",
                    height: t.size_bg + "px",
                    cursor: "nw-resize",
                });
                t.sz.on("mousedown", function (e) {
                    t.s = true;
                    t.old_width = t.t.width();
                    t.old_height = t.t.height();
                    t.old_size_x = e.pageX;
                    t.old_size_y = e.pageY;
                    // 缩放期间禁用 iframe 指针事件，避免 iframe 吞掉 mousemove
                    t.t.find("iframe").css("pointer-events", "none");
                    $(document).on("mousemove", function (e) {
                        t.new_width = e.pageX - t.old_size_x + t.old_width;
                        t.new_height = e.pageY - t.old_size_y + t.old_height;
                        t.t.width(t.new_width);
                        t.t.height(t.new_height);
                        if (t.t.outerHeight() + t.top >= t.w_height) {
                            t.t.height(t.w_height - t.top - t.c_height);
                        }
                        if (t.t.outerWidth() + t.left >= t.w_width) {
                            t.t.width(t.w_width - t.left - t.c_width);
                        }
                        return false;
                    });
                    $(document).on("mouseup", function () {
                        t.height = t.t.outerHeight();
                        t.width = t.t.outerWidth();
                        t.s = false;
                        t.t.find("iframe").css("pointer-events", "");
                        $(document).off("mousemove");
                        $(document).off("mouseup");
                    });
                    return false;
                });
            },
            leave: function (xx, yy) {
                var t = this;
                if (
                    xx >= t.t.offset().left &&
                    xx <= t.t.offset().left + t.width &&
                    yy >= t.t.offset().top &&
                    yy <= t.t.offset().top + t.height
                ) {
                    return false;
                } else {
                    return true;
                }
            },
            top_animate: function () {
                var t = this;
                t.t.animate({ top: -t.height + t.hide }, 300, function () {
                    t.t.one("mouseenter", function () {
                        t.t.stop(true).animate({ top: 0 }, 300);
                    });
                });
            },
            left_animate: function () {
                var t = this;
                t.t.animate({ left: -t.width + t.hide }, 300, function () {
                    t.t.one("mouseenter", function () {
                        t.t.stop(true).animate({ left: 0 }, 300);
                    });
                });
            },
            right_animate: function () {
                var t = this;
                t.t.animate({ left: t.w_width - t.hide }, 300, function () {
                    t.t.one("mouseenter", function () {
                        t.t.stop(true).animate({ left: t.w_width - t.width }, 300);
                    });
                });
            },
            restore: function () {
                var t = this;
                t.t.stop(true, true);
                // 清除吸边动画绑定的 mouseenter 恢复回调，避免手动恢复后鼠标移入触发多余动画
                t.t.off("mouseenter");
                var inlineLeft = t.t[0].style.left;
                var parsed = parseInt(inlineLeft);
                // 未拖动过（初始/hidePanel 模式 inlineLeft 为空）或被吸边（left 在屏幕外）→ 恢复到右侧默认位置
                if (!inlineLeft || parsed < 0 || parsed > t.w_width - t.width) {
                    t.t.css({ left: "", right: "12px", top: "8px" });
                    t.top = t.t.offset().top - $(window).scrollTop();
                    t.left = t.t.offset().left - $(window).scrollLeft();
                } else {
                    // 面板在可见区域 → 恢复到上次 mouseup 记录的位置
                    t.t.css({ top: t.top, left: t.left, right: "" });
                }
            },
        };
        var y = {
            move: ".title",
            closed: ".close",
            size: 0,
        };
        $.fn.bg_move = function (bg) {
            var cfg = $.extend({}, y, bg);
            return $(this).each(function () {
                $(this).data("bg_move", new b($(this), cfg));
            });
        };
    })(jQuery);
    /* ======================= WebsitePusher 组件主体（扁平方法 + 分区） ======================= */
    // IIFE 包裹: site 等内部常量留在闭包内不污染宿主 window, 仅 WebsitePusher 作为对外入口暴露
    var WebsitePusher = (function () {
        // 静态资源 CDN 根路径, settings.cssSite/jsSite 默认基于它拼接
        var site = "https://ws.phprm.com/static/";
        var WebsitePusher = {
            settings: {
                siteName: "一封传话聚合推送",
                apiKey: "amvk2ag1hwfswq",
                cssSite: site + "customer/css/",
                jsSite: site + "customer/js",
                pcUrl: "https://ws.phprm.com/pc.html",
                pushUrl: "http://push.phprm.com/",
                apiUrl: "https://www.phprm.com/push/h5/app/api/getDataInfo",
                authUrl: "https://www.phprm.com/oauth2",
                wsUrl: "https://2120ws.phprm.com",
                channelMemberUrl: "https://ws.phprm.com/api/channelMember.php",
                appName: "弹幕",
                channelCode: "",
                channelName: "",
                shareFlag: 1,
                group: 1,
                uid: "",
                name: "",
                createTime: "",
                token: "",
                avatar: "",
                device: "",
                clientVersion: "1.0",
                screenResolution: "1080,720",
                userPlatformType: "",
                userPlatformVersion: "",
                hideDialog: 0,
                hidePanel: 0,
                danMu: 0,
                closeText: "关闭",
                danMuSetting: {
                    opacity: 50,
                    size: 20,
                    speed: 20,
                    close: 1,
                    like: 0,
                    bottom: 70,
                    bottomradio: 0,
                    aiDanMu: 0,
                    aiDanMuUrl: "",
                    selector: "body",
                    color: "#fff",
                    hideIcon: 0
                },
                // 上一次推送成功的messageIdList和容量限制
                messageIdList: new Array(),
                messageLength: 20,
                sendCallback: function (item, settings) {
                    return true;
                },
                configCallback: function () {
                    return true;
                },
                danMuInitCallback: function (settings) {
                    // 这里可以插入网站启动弹幕send API, 当设置return false即使用户配置和url参数开启弹幕依然无法启用弹幕
                    return true;
                },
                danMuSendOpen: function (settings) {
                    // 弹幕发送开启回调, 点击右下角图标第一次触发
                },
                danMuSendClose: function (settings) {
                    // 弹幕发送关闭回调, 点击右下角图标第二次触发
                },
                danMuSendOpened: false,
                danMuFilter: function (item) {
                    var _this = this;
                    // item.id即推送API返回的messageIdList里的第一个消息ID, 后端每次发送弹幕可关联业务评论ID与消息ID, 反查评论ID点赞数为0传给插件
                    item.num = 0;
                    // 每一条弹幕都可以回传给调用方判断是否展示, 允许异步方式过滤弹幕(例如根据item.id查询点赞次数), 也可以直接同步展示this.danMuPopCallback(item）
                    return this.danMuFilterCallback(item, function (dom) {
                        _this.danMuPopCallback(dom, item);
                    });
                },
                danMuFilterCallback: function (item, callback) {
                    // 按 item.id 进行重复性过滤: 已展示过的id直接丢弃, 避免同一条弹幕重复飞过(ES5兼容, Object map代替Set)
                    var id = item && item.id != null ? String(item.id) : "";
                    // 没有id的弹幕不给展示
                    if (id === "") {
                        return;
                    }
                    if (!this.danMuSeenIds) {
                        this.danMuSeenIds = {};
                        this.danMuSeenCount = 0;
                    }
                    if (this.danMuSeenIds[id]) {
                        return;
                    }
                    this.danMuSeenIds[id] = true;
                    this.danMuSeenCount += 1;
                    // 超过2000条重置, 防止长时间运行内存泄漏
                    if (this.danMuSeenCount > 2000) {
                        this.danMuSeenIds = {};
                        this.danMuSeenCount = 1;
                        this.danMuSeenIds[id] = true;
                    }
                    // info 去两侧空白后为空则不展示 (ES5兼容, String.prototype.trim代替正则)
                    var hasInfo = item && item.info != null;
                    var infoStr = hasInfo ? String(item.info) : "";
                    var trimmed =
                        hasInfo && typeof String.prototype.trim === "function"
                            ? infoStr.trim()
                            : infoStr.replace(/^\s+|\s+$/g, "");
                    if (trimmed === "") {
                        return;
                    }
                    // 自定义弹幕挂载节点或者样式: 从danMuSetting读取selector(js原生dom选择器字符串), 默认body
                    var dom = this.danMuSetting.selector || "body";
                    // 暂停时暂存到队列, 恢复时统一渲染(不丢消息)
                    if (this.danMuPaused) {
                        if (!this.danMuQueue) this.danMuQueue = [];
                        this.danMuQueue.push({ dom: dom, item: item, callback: callback });
                        return;
                    }
                    // 先回调让调用方设置 item.onAction 等字段, 再交给 barrager.js 渲染
                    // (barrager.js 内部 $.extend 会拷贝 item 快照, 后续修改原始 item 不会同步)
                    callback(dom, item);
                    $(dom).barrager(item);
                },
                danMuPopCallback: function (dom, item) {
                    // 给item绑定事件 (barrager.js 通过 .call(div_barrager[0], barrage, action) 触发, this 指向弹幕DOM)
                    item.onAction = function (barrage, action) {
                        // 这里可以根据action对弹幕进行操作
                        //  - action: 'close' 关闭 | 'like' 点赞 | 'unlike' 取消点赞
                        console &&
                        console.log("弹幕被点击:", action, "内容:", barrage.info);
                    };
                },
                checkAiDanMu: function (doc, pollCount) {
                    var _this = WebsitePusher;
                    var s = _this.settings;
                    pollCount =
                        typeof pollCount === "number" && pollCount > 0 ? pollCount : 1;
                    if (_this.danMuTimer) {
                        window.clearTimeout(_this.danMuTimer);
                    }
                    if (s.danMu != 1 || s.danMuSetting.aiDanMu <= 0) {
                        return;
                    }
                    if (!s.channelCode) {
                        return;
                    }
                    var headers = _this.getSignHeaders();
                    var body = _this.buildAiDanMuBody();
                    var params = {
                        type: "checkAiDanMu",
                        appKey: "pushBookmark",
                        channelCode: s.channelCode,
                        title: document.title,
                        body: body,
                        referer: window.location.href,
                        pollCount: pollCount,
                        _t: headers["apiTimestamp"],
                        settings: JSON.stringify(s)
                    };
                    _this.ajaxGet(
                        s.danMuSetting.aiDanMuUrl || s.apiUrl,
                        params,
                        headers,
                        function (resp) {
                            console.log("AI response：" + JSON.stringify(resp));
                            if (resp.code == 0 && resp.data) {
                                var data = resp.data;
                                if (!data["aiRestAmount"] || data["aiRestAmount"] <= 0) {
                                    $(doc).find("#aiDanMuGroup").hide();
                                    return;
                                }
                                if (s.messageIdList.length > s.messageLength) {
                                    s.messageIdList.splice(
                                        0,
                                        s.messageIdList.length - s.messageLength,
                                    );
                                }
                                var aiMessageIdList = data["messageIdList"] || [];
                                for (var i = 0; i < aiMessageIdList.length; i++) {
                                    s.messageIdList.push(aiMessageIdList[i]);
                                }
                                _this.danMuTimer = window.setTimeout(function () {
                                    s.checkAiDanMu(doc, pollCount + 1);
                                }, s.danMuSetting.aiDanMu * 1000);
                            }
                        },
                        function () {},
                    );
                }
            },
            resetSettings: function () {
                var s = this.settings;
                s.channelCode = "";
                s.uid = "";
                s.name = "";
                s.createTime = "";
                s.token = "";
            },
            initSetting: function (options, callback) {
                var _this = this;
                var s = _this.settings;
                _this.resetSettings();
                _this.extend(s, options);
                var appName = this.getUrlParam("appName") || s.appName;
                var device = this.getUrlParam("device") || s.device;
                var version = this.getUrlParam("clientVersion") || s.clientVersion;
                var screenResolution = this.getUrlParam("screenResolution") || s.screenResolution;
                if (appName) {
                    s.appName = appName;
                }
                if (s.danMu) {
                    s.siteName = s.appName;
                }
                if (version) {
                    s.clientVersion = version;
                }
                if (screenResolution) {
                    s.screenResolution = screenResolution;
                } else {
                    // URL 参数未携带分辨率时, 用 JS 读取屏幕宽高 (逗号分隔, 与其他来源格式一致)
                    try {
                        var w =
                            window.screen && window.screen.width
                                ? window.screen.width
                                : 0;
                        var h =
                            window.screen && window.screen.height
                                ? window.screen.height
                                : 0;
                        if (w > 0 && h > 0) {
                            s.screenResolution = String(w) + "," + String(h);
                        }
                    } catch (e) {}
                }
                if (!s.userPlatformType && !s.userPlatformVersion) {
                    var explorerInfo = this.getExplorerInfo();
                    s.userPlatformType = explorerInfo["type"];
                    s.userPlatformVersion = explorerInfo["version"];
                }
                // settings 内存对象已保存所有字段, 无需再镜像到 DOM hidden input
                if (s.uid && s.token) {
                    if (callback) {
                        callback();
                    }
                    return;
                }
                if (device) {
                    s.device = device;
                    if (callback) {
                        callback();
                    }
                    return;
                }
                if (typeof Fingerprint2 === "undefined") {
                    this.parallelLoadScripts(
                        [s.jsSite + "/fingerprint2.min.js"],
                        function () {
                            _this.updateSettingDevice(callback);
                        },
                    );
                } else {
                    _this.updateSettingDevice(callback);
                }
            },
            updateSettingDevice: function (callback) {
                var _this = this;
                Fingerprint2.get(function (components) {
                    var values = components.map(function (component, index) {
                        if (index === 0) {
                            return component.value.replace(/\bNetType\/\w+\b/, "");
                        }
                        return component.value;
                    });
                    _this.settings.device = Fingerprint2.x64hash128(values.join(""), 31);
                    if (callback) {
                        callback();
                    }
                });
            },
            getUrlParam: function (name) {
                var aQuery = window.location.href.split("?");
                var aGET = "";
                if (aQuery.length > 1) {
                    var aBuf = aQuery[1].split("&");
                    for (var i = 0; i < aBuf.length; i++) {
                        var aTmp = aBuf[i].split("=");
                        if (aTmp.length < 2) {
                            continue;
                        } else {
                            if (aTmp[0] == name) aGET = aTmp[1];
                        }
                    }
                }
                return aGET;
            },
            getExplorerInfo: function () {
                var ua = navigator.userAgent.toLocaleLowerCase();
                var browser = {
                    type: "Chrome",
                    version: 0,
                };
                try {
                    var rules = [
                        { p: /msie|trident/, t: "IE", v: /msie ([\d.]+)|rv:([\d.]+)/ },
                        { p: /edg/, t: "Edge", v: /edg\/([\d.]+)/ },
                        { p: /firefox/, t: "Firefox", v: /firefox\/([\d.]+)/ },
                        { p: /ucbrowser/, t: "UCBrowser", v: /ucbrowser\/([\d.]+)/ },
                        { p: /opera|opr/, t: "Opera", v: /opera\/([\d.]+)|opr\/([\d.]+)/ },
                        {
                            p: /baidubrowser/,
                            t: "Baidubrowser",
                            v: /baidubrowser\/([\d.]+)/,
                        },
                        {
                            p: /sogou|metasr/,
                            t: "Sogou",
                            v: /sogou\/([\d.]+)|metasr ([\d.]+)/,
                        },
                        {
                            p: /tencenttraveler|qqbrowser/,
                            t: "qqbrowser",
                            v: /tencenttraveler\/([\d.]+)|qqbrowser\/([\d.]+)/,
                        },
                        {
                            p: /micromessenger/,
                            t: "Micromessenger",
                            v: /micromessenger\/([\d.]+)/,
                        },
                        { p: /maxthon/, t: "maxthon", v: /maxthon\/([\d.]+)/ },
                    ];
                    var matched = false;
                    for (var i = 0; i < rules.length; i++) {
                        if (rules[i].p.test(ua)) {
                            browser.type = rules[i].t;
                            var m = ua.match(rules[i].v);
                            if (m) {
                                browser.version = m[1] || m[2] || m[0];
                            }
                            matched = true;
                            break;
                        }
                    }
                    if (!matched) {
                        if (ua.match(/chrome/) != null) {
                            function _mime(option, value) {
                                var mimeTypes = navigator.mimeTypes;
                                for (var mt in mimeTypes) {
                                    if (mimeTypes[mt][option] == value) {
                                        return true;
                                    }
                                }
                                return false;
                            }
                            browser.type = _mime(
                                "type",
                                "application/vnd.chromium.remoting-viewer",
                            )
                                ? "WOW64"
                                : "Chrome";
                            browser.version = ua.match(/chrome\/([\d.]+)/)[1];
                        } else if (ua.match(/safari/) != null) {
                            browser.type = "Safari";
                            var vRegex =
                                ua.indexOf("version") == -1
                                    ? /safari\/([\d.]+)/
                                    : /version\/([\d.]+)/;
                            browser.version = ua.match(vRegex)[1];
                        }
                    }
                } catch (error) {}
                return browser;
            },
            styleIframe: function () {
                if (document.all) {
                    var sheet = document.createStyleSheet();
                    sheet.addRule("iframe", "max-height: 2000px;margin-top:-3px");
                } else {
                    var style = document.createElement("style");
                    style.type = "text/css";
                    style.innerHTML = "iframe{ max-height: 2000px;margin-top:-3px }";
                    document.getElementsByTagName("HEAD").item(0).appendChild(style);
                }
            },
            buildPanel: function (panelId, closeCallback, onClosed) {
                var panelStyle = "";
                if (this.settings.hidePanel == 1) {
                    panelStyle = "display:none";
                }
                var div = document.createElement("div");
                div.id = panelId;
                div.style.cssText =
                    "position:fixed;_position:absolute;right:12px;top:8px;_top:expression(eval(documentElement.scrollTop+8));width:460px;z-index:2147483647;border-width:0px;user-select:none;" +
                    panelStyle;
                var s = this.settings.cssSite;
                div.innerHTML =
                    '<div class="topbjcl" style="user-select:none;cursor:move;height:33px;background-image:url(' +
                    s +
                    'images/1.gif);background-repeat:repeat-x;border:1px solid #d8d8d8;border-bottom:none">' +
                    '<div style="padding-top:5px;padding-left:20px;float:left;color:#555;font-family:Arial,Helvetica,sans-serif;font-size:12px;">' +
                    '<span class="logo-text">' +
                    this.settings.siteName +
                    "</span>" +
                    "</div>" +
                    '<div style="cursor:pointer;float:right;padding-right:10px;padding-top:3px">' +
                    '<span title="关闭"><img class="pusher-close-btn" src="' +
                    s +
                    'images/4.gif" /></span>' +
                    "</div>" +
                    "</div>" +
                    '<div style="width:470px;padding:0px;" class="ydnwc-dialog">' +
                    closeCallback +
                    "</div>";
                document.body.appendChild(div);
                $("#" + div.id).bg_move({
                    move: ".topbjcl",
                    closed: ".pusher-close-btn",
                    size: 6,
                    onClosed: onClosed,
                });
                return div;
            },
            buildPusherWindowHtml: function () {
                var s = this.settings,
                    ds = s.danMuSetting;
                return (
                    "<!DOCTYPE html><html>" +
                    "<head>" +
                    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />' +
                    "<title></title>" +
                    '<link href="' +
                    s.cssSite +
                    'pusher.css" rel="stylesheet" type="text/css" />' +
                    "</head>" +
                    '<body style="margin:0px;padding:0px;">' +
                    '<div class="main">' +
                    '<div class="main-pusher" style="display: none">' +
                    '<div class="channel-input" id="channelInput">' +
                    '<div style="height:33px">' +
                    '<div class="lf" style="padding-top:8px">请输入您的通道码然后点击 ”打开推送通道 ”按钮</div>' +
                    '<div class="rt lan360" style="padding-top:8px"></div>' +
                    "</div>" +
                    '<div id="channelMsg" class="msg"></div>' +
                    '<div class="channel-group">' +
                    '<span style="clear:both;position:relative">' +
                    '<input type="text" class="serchpt channelCode" name="channelCode" spellcheck="false" placeholder="通道码/口令"/>' +
                    "</span>" +
                    '<span class="pusher-button"><button class="btn btn-primary" width="105" height="35">打开推送通道</button></span>' +
                    "</div>" +
                    '<div class="form-button">\n' +
                    '<input type="button" name="add" value="增加更多通道" class="add-button btn" />\n' +
                    "</div>" +
                    "</div>" +
                    '<div style=" text-align:center; padding-top:153px; height:38px;"><img src="' +
                    s.cssSite +
                    'images/26.gif" width="434" height="7" /></div>' +
                    '<div style=" text-align:center; height:38px;">' +
                    '<div class="footer">' +
                    '<a href="javascript:void(0)" class="nav-button loginButton" target="_self"></a>' +
                    '<a href="' +
                    s.pushUrl +
                    "/host.html?type=obtain&from=danMu" +
                    '" class="nav-button" target="_blank">获取通道码</a>' +
                    "</div>" +
                    "</div>" +
                    "</div>" +
                    '<div class="main-config" style="display: none">' +
                    '<div class="danmu-config" id="danmuConfig">' +
                    '<div style="height:33px">' +
                    '<div class="lf" style="padding-top:8px">弹幕设置</div>' +
                    '<div class="rt lan360" style="padding-top:8px"></div>' +
                    "</div>" +
                    '<div id="danmuMsg" class="msg"></div>' +
                    '<form class="form-horizontal">' +
                    '<div class="form-group">' +
                    '<label class="col-sm-2 control-label">不透明度</label>' +
                    '<div class="col-sm-2">' +
                    '<input type="text" value="" name="opacity" class="form-control" placeholder="' +
                    ds.opacity +
                    '" value="' +
                    ds.opacity +
                    '"  />' +
                    "</div>" +
                    '<label class="col-sm-2 control-label">大小(px)</label>' +
                    '<div class="col-sm-2">' +
                    '<input  class="form-control" name="size" type="text" placeholder="' +
                    ds.size +
                    '" value="' +
                    ds.size +
                    '" />' +
                    "</div>" +
                    "</div>" +
                    '<div class="form-group">' +
                    '<label class="col-sm-2 control-label">速度</label>' +
                    '<div class="col-sm-2">' +
                    '<input  class="form-control" name="speed" type="text" placeholder="' +
                    ds.speed +
                    '" value="' +
                    ds.speed +
                    '" />' +
                    "</div>" +
                    '<label class="col-sm-2 control-label">' +
                    s.closeText +
                    "</label>" +
                    '<div class="col-sm-2">' +
                    '<input  class="form-control" name="close" type="checkbox" ' +
                    (ds.close ? "checked" : "") +
                    " />" +
                    "</div>" +
                    "</div>" +
                    '<div class="form-group">' +
                    '<label class="col-sm-2 control-label">高度</label>' +
                    '<div class="col-sm-3">' +
                    '<label class="radio-inline">' +
                    '<input type="radio" name="bottomradio" value="0" ' +
                    (ds.bottomradio == 0 ? 'checked="checked"' : "") +
                    " /> 随机" +
                    "</label>" +
                    '<label class="radio-inline">' +
                    '<input type="radio" name="bottomradio" value="1" ' +
                    (ds.bottomradio == 1 ? 'checked="checked"' : "") +
                    " />设置" +
                    "</label>" +
                    "</div>" +
                    '<div class="col-sm-1" >&nbsp;</div>' +
                    '<div class="col-sm-2">' +
                    '<input class="form-control" name="bottom" type="text" placeholder="' +
                    ds.bottom +
                    '"  value="' +
                    ds.bottom +
                    '" />' +
                    "</div>" +
                    "</div>" +
                    '<div class="form-group" id="aiDanMuGroup">' +
                    '<label class="col-sm-2 control-label">AI弹幕</label>' +
                    '<div class="col-sm-3">' +
                    '<label class="radio-inline">' +
                    '<input type="radio" name="airadio" value="0" ' +
                    (ds.aiDanMu > 0 ? "" : 'checked="checked"') +
                    " /> 关闭" +
                    "</label>" +
                    '<label class="radio-inline">' +
                    '<input type="radio" name="airadio" value="1" ' +
                    (ds.aiDanMu > 0 ? 'checked="checked"' : "") +
                    " />间隔" +
                    "</label>" +
                    "</div>" +
                    '<div class="col-sm-1" >&nbsp;</div>' +
                    '<div class="col-sm-2">' +
                    '<input class="form-control" name="aiDanMu" type="text" placeholder="30"  value="' +
                    (ds.aiDanMu > 0 ? ds.aiDanMu : "") +
                    '" />' +
                    "</div>" +
                    "</div>" +
                    "</form>" +
                    "</div>" +
                    '<div style=" text-align:center; height:38px;"><img src="' +
                    s.cssSite +
                    'images/26.gif" width="434" height="7" /></div>' +
                    '<div style=" text-align:center; height:38px;">' +
                    '<div class="footer">' +
                    '<a href="javascript:void(0)" class="nav-button saveButton" target="_self">保存</a>' +
                    '<a href="javascript:void(0)" class="nav-button resetButton" target="_self">重置</a>' +
                    "</div>" +
                    "</div>" +
                    "</div>" +
                    '<div style=" text-align:center; height:38px;margin-top: 70px">' +
                    '<div class="footer">' +
                    '<a href="javascript:void(0)" class="nav-button" id="loading" target="_self">加载中...</a>' +
                    "</div>" +
                    "</div>" +
                    "</div>" +
                    "</body></html>"
                );
            },
            initPusherWindow: function (checkLoginStatus, channelCode) {
                var _this = this;
                var s = _this.settings;
                // 用本次 init 传入的 channelCode 覆盖共享 s.channelCode, 防止并发 init 竞态
                // 未传 channelCode(undefined) 时按空字符串处理, 确保走 if(!s.channelCode) 分支不请求
                s.channelCode = channelCode || "";
                _this.closePusher(true);
                _this.closeLogin();
                this.buildPanel(
                    "pushWebAnonymous",
                    '<div id="pusherNewWindow" style="width:470px;padding:0px;" class="ydnwc-dialog"><div id="pusherViewLogin" style="width:470px;height:490px;"></div></div>',
                    function () {
                        _this.closePusher();
                    },
                );
                var frameHtml =
                    "<iframe frameborder='0' src=\"javascript:void((function(){var d=document;d.open();document.domain='" +
                    document.domain +
                    "';d.write('');d.close()})())\" scrolling='no' width='470' height='490' id='pusherFrame' allowtransparency></iframe>";
                $("#pusherViewLogin").html(frameHtml);
                var frame = $("#pusherFrame")[0];
                try {
                    var doc = frame.contentWindow.document;
                    var $doc = $(doc);
                    doc.open();
                    var html = _this.buildPusherWindowHtml();
                    doc.write(html);
                    doc.close();

                    $doc.find("#loading").text("正在加载中...");
                    $doc.find(".main").fadeIn(100, function () {
                        $doc.find("#loading").hide();
                        $doc.find(".main-pusher").fadeIn(100);
                        // checkLoginStatus: init()传true检查登录态; 用户点"匿名推送"传false不自动跳转
                        // 弹幕模式下推送窗口不自动检查登录态(避免弹幕初始化时跳转登录窗口), 但unlogin打开的登录窗口仍需检查
                        if (checkLoginStatus && !s.hidePanel && s.danMu != 1) {
                            _this.checkLoginStatus(doc, function (resp) {
                                var data = resp.data;
                                if (data && data["userInfo"]) {
                                    $doc
                                        .find(".loginButton")
                                        .text("用户" + data["nickname"] + "已登录");
                                    _this.loginSuccess($doc.find(".main-login"));
                                    _this.unlogin($doc.find(".loginButton").get(0));
                                } else {
                                    _this.logout($doc.find(".main-pusher").get(0));
                                }
                            });
                        } else {
                            $doc.find(".loginButton").text("登录账户");
                        }
                    });

                    $doc.find(".loginButton").click(function () {
                        _this.unlogin(this);
                    });
                    $doc.find(".saveButton").click(function () {
                        if (_this.danMuTimer) {
                            window.clearTimeout(_this.danMuTimer);
                        }
                        var $form = $doc.find("#danmuConfig form");
                        var num = function (name, def) {
                            var v = $form.find("input[name=" + name + "]").val();
                            return isNaN(v) ? def : Math.ceil(v);
                        };
                        var opacity = num("opacity", 100);
                        var size = num("size", 20);
                        var speed = num("speed", 16);
                        var close = $form.find("input[name=close]").is(":checked");
                        var bottomradio = $form
                            .find("input[name='bottomradio']:checked")
                            .val();
                        var airadio = $form.find("input[name='airadio']:checked").val();
                        var bottom = num("bottom", 0);
                        var aiSec = num("aiDanMu", 0);
                        // AI弹幕: airadio=间隔 且秒数合法(1~600, 非法按默认30)时为轮询秒数, 否则0=关闭
                        var aiDanMu =
                            airadio == 1 ? (aiSec < 1 || aiSec > 600 ? 30 : aiSec) : 0;
                        var json = {
                            opacity: opacity < 1 || opacity > 100 ? 100 : opacity,
                            size: size < 8 || size > 33 ? 20 : size,
                            speed: speed < 1 || speed > 50 ? 16 : speed,
                            close: close ? 1 : 0,
                            bottomradio: bottomradio == 1 ? 1 : 0,
                            bottom:
                                bottomradio == 1 && (bottom < 1 || bottom > 2000)
                                    ? 0
                                    : bottom
                                    ? bottom
                                    : 0,
                            aiDanMu: aiDanMu
                        };
                        _this.setDanMuStorage(JSON.stringify(json));
                        _this.updateCfgCache(json);
                        // 范围校验配置
                        var ranges = [
                            [
                                opacity,
                                1,
                                100,
                                100,
                                "弹幕不透明度范围1~100, 已按默认值100保存",
                                "opacity",
                            ],
                            [
                                size,
                                6,
                                33,
                                20,
                                "字体大小范围9~33px, 已按默认值20px保存",
                                "size",
                            ],
                            [speed, 1, 50, 16, "弹幕速度范围1~50, 已按默认值16保存", "speed"],
                            [
                                bottom,
                                1,
                                2000,
                                0,
                                "弹幕高度范围1~2000, 已按默认值0保存",
                                "bottom",
                            ],
                        ];
                        if (bottomradio == 1) {
                            for (var r = 0; r < ranges.length; r++) {
                                if (_this.rangeFail.apply(_this, [doc].concat(ranges[r])))
                                    return;
                            }
                        } else {
                            for (var r2 = 0; r2 < 3; r2++) {
                                if (_this.rangeFail.apply(_this, [doc].concat(ranges[r2])))
                                    return;
                            }
                        }
                        if (
                            airadio == 1 &&
                            _this.rangeFail(
                                doc,
                                aiSec,
                                1,
                                600,
                                30,
                                "AI弹幕间隔范围1~600, 已按默认值30保存",
                                "aiDanMu"
                            )
                        ) {
                            s.danMuSetting.aiDanMu = 0;
                            return;
                        } else {
                            s.danMuSetting.aiDanMu = aiDanMu;
                            if (airadio == 1) {
                                s.checkAiDanMu(this.ownerDocument);
                            }
                        }
                        _this.showDanMuMsg(doc, "配置已生效");
                    });
                    $doc.find(".resetButton").click(function () {
                        var $form = $doc.find("#danmuConfig form");
                        var resetFields = [
                            { sel: "input[name=opacity]", val: "" },
                            { sel: "input[name=size]", val: "" },
                            { sel: "input[name=speed]", val: "" },
                            { sel: "input[name=bottom]", val: "70" },
                            { sel: "input[name=aiDanMu]", val: "30" },
                        ];
                        for (var i = 0; i < resetFields.length; i++) {
                            $form.find(resetFields[i].sel).val(resetFields[i].val);
                        }
                        $form.find("input[name=close]").prop("checked", true);
                        $form
                            .find("input[name='bottomradio'][value='0']")
                            .prop("checked", true);
                        $form
                            .find("input[name='airadio'][value='0']")
                            .prop("checked", true);
                        _this.showDanMuMsg(doc, "配置已重置");
                        // 清理上一轮定时器并重新查询AI弹幕
                        if (_this.danMuTimer) {
                            window.clearTimeout(_this.danMuTimer);
                        }
                        s.danMuSetting.aiDanMu = 0;
                        _this.removeDanMuStorage();
                        _this.updateCfgCache({});
                    });
                    $doc.find(".channelCode").keyup(function () {
                        $(this)
                            .parents(".channel-input")
                            .find("div[id='channelMsg']")
                            .text("");
                    });
                    $doc.find(".add-button").click(function () {
                        _this.addChannelInput(this);
                    });
                    $doc.find(".pusher-button").click(function () {
                        _this.openPusherDialog(this);
                    });
                    // 从url参数中读取是否传
                    if (!s.channelCode) {
                        // 如果当前网址开启了弹幕
                        var headers = _this.getSignHeaders();
                        _this.ajaxGet(
                            s.apiUrl,
                            {
                                type: "checkUrlChannelCode",
                                appKey: "pushBookmark",
                                referer: window.location.href,
                                title: document.title,
                                _t: headers["apiTimestamp"],
                            },
                            headers,
                            function (resp) {
                                if (resp.code != 0 || !resp.data) {
                                    return;
                                }
                                var data = resp.data;
                                if (data["channelCode"]) {
                                    $doc.find(".channelCode:eq(0)").val(data["channelCode"]);
                                    s.channelCode = data["channelCode"];
                                    _this.openPusherDialog($doc.find(".channelCode").get(0));
                                    if (!data["aiRestAmount"] || data["aiRestAmount"] <= 0) {
                                        $doc.find("#aiDanMuGroup").hide();
                                    }
                                }
                            },
                            function () {},
                        );
                        return;
                    }
                    $doc.find(".channelCode:eq(0)").val(s.channelCode);
                    _this.openPusherDialog($doc.find(".channelCode").get(0));
                } catch (err) {
                    console && console.log(err);
                }
            },
            checkLoginStatus: function (doc, callback) {
                var _this = this;
                var $doc = $(doc);
                $doc.find(".loginButton").text("登录账户");
                var appKey = this.cookieGet("appKey");
                if (!appKey) {
                    return;
                }
                var headers = _this.getSignHeaders();
                _this.ajaxGet(
                    _this.settings.apiUrl,
                    { type: "getUserInfo", appKey: appKey, _t: headers["apiTimestamp"] },
                    headers,
                    function (resp) {
                        if (!resp["code"] || !resp["data"] || !resp["data"]["appKey"]) {
                            $doc.find("#divTodo").hide();
                            $doc.find("#divLogin").show();
                        }
                        if (callback) {
                            callback(resp);
                        }
                    },
                    function () {
                        $doc.find("#divTodo").hide();
                        $doc.find("#divLogin").show();
                    },
                    {
                        beforeSend: function (data) {
                            $doc.find("#divLogin").hide();
                            $doc.find("#divTodo").show();
                        },
                    },
                );
            },
            channelMemberFail: function (resp, input, group, channelCodes) {
                var _this = this;
                console &&
                console.error(channelCodes + "查询浏览器通道异常, 无法弹出挂件");
                if ($("#pushWebAnonymous").is(":hidden")) {
                    $("<link>", {
                        rel: "stylesheet",
                        href: _this.settings.jsSite + "/layer/theme/default/layer.css",
                    }).appendTo("head");
                    seriesLoadPusherScripts(
                        [
                            _this.settings.jsSite + "/layui/layui.min.js",
                            _this.settings.jsSite + "/layui/lay/modules/layer.js",
                            _this.settings.jsSite + "/md5.js",
                        ],
                        function () {
                            // 弹出输入框并获取输入值
                            layer.prompt(
                                {
                                    id: channelCodes,
                                    formType: 0,
                                    value: "",
                                    title: resp.message + ", 请输入其他通道码",
                                },
                                function (value, index) {
                                    if (value.length != 32) {
                                        // 创建警告框
                                        layer.alert("通道码为32位字母和数字组成", {
                                            icon: 6,
                                            title: "警告",
                                            btn: ["确认"],
                                            yes: function (index, layero) {
                                                // 按钮回调函数
                                                layer.close(index);
                                            },
                                        });
                                        return;
                                    }
                                    // 弹出输入框并获取输入值
                                    group.find("input[name='channelCode']").val(value);
                                    _this.openPusherDialog(group.find(".pusher-button").get(0));
                                    // 关闭输入框
                                    layer.close(index);
                                },
                            );
                        },
                    );
                } else {
                    input.find("div[id='channelMsg']").text(resp.message);
                }
            },
            channelMemberSuccess: function (resp, input, group, channelCodes) {
                var _this = this;
                var data = resp.data;
                input.find("div[id='channelMsg']").text("");
                if (data.pushType == 1) {
                    var params = {
                        url: _this.settings.pcUrl,
                        channelName:
                            data.status != 1
                                ? data.channelName + "(未开启)"
                                : data.channelName,
                        uid: data.channelMemberRelId,
                        name: data.nickname,
                        createTime: data.createTime,
                        avatar: data.avatar,
                        group: data.group,
                        channelCode: data.channelCode,
                        token: data.token,
                        shareFlag: data.shareFlag
                    };
                    _this.initPusherKF(params);
                    input.find(".lf").text(data.channelName);
                } else if (data.pushType == 10) {
                    var counter = 0;
                    var children = data.childrenChannelMember;
                    if (children.length == 0) {
                        console &&
                        console.error(
                            "组合通道码" +
                            data.channelCode +
                            "未绑定浏览器子通道, 无法弹出挂件",
                        );
                    }
                    for (var i = 0; i < children.length; i++) {
                        if (children[i]["pushType"] != 1) {
                            continue;
                        }
                        if (i == 0) {
                            group
                                .find("input[name='channelCode']")
                                .val(children[i]["channelCode"]);
                        } else {
                            _this.addChannelInput(
                                input.find("input[name='add']"),
                                children[i]["channelCode"],
                            );
                        }
                        // 立即自动触发
                        var $pusher = input.find(".pusher-button");
                        var next = $pusher
                            .parents(".channel-group")
                            .find("input[name='channelCode']")
                            .val();
                        if (next != channelCodes) {
                            _this.openPusherDialog($pusher.get($pusher.length - 1));
                        }
                        counter++;
                    }
                    if (counter == 0) {
                        input
                            .find("div[id='channelMsg']")
                            .text("该通道下没有浏览器推送子通道");
                    }
                } else {
                    input
                        .find("div[id='channelMsg']")
                        .text("暂时不支持非浏览器推送方式的通道");
                }
            },
            openPusherDialog: function (button) {
                var _this = this;
                var s = _this.settings;
                var input = $(button).parents(".channel-input");
                var group = $(button).parents(".channel-group");
                var channelCodes = group.find("input[name='channelCode']").val();

                if (!channelCodes || channelCodes.length == 0) {
                    input.find("div[id='channelMsg']").text("请填写通道码再点击按钮");
                    return;
                }
                var params;
                if (s.token) {
                    params = {
                        channelCode: channelCodes,
                        uid: s.uid,
                        token: s.token,
                        createTime: s.createTime,
                        avatar: s.avatar
                    };
                } else {
                    // 设备/环境参数直接从 settings 内存对象取, 不再通过 DOM hidden input 中转
                    params = {
                        channelCode: channelCodes,
                        appName: s.appName,
                        clientVersion: s.clientVersion,
                        device: s.device,
                        screenResolution: s.screenResolution,
                        userPlatformType: s.userPlatformType,
                        userPlatformVersion: s.userPlatformVersion,
                        userUa: window.navigator.userAgent.toLowerCase()
                    };
                }
                $.ajax({
                    url: s.channelMemberUrl,
                    dataType: "json",
                    data: params,
                    success: function (resp) {
                        if (resp.code != 0) {
                            _this.channelMemberFail(resp, input, group, channelCodes);
                            return;
                        }
                        if (s.danMu == 1) {
                            var danMuInit = s.danMuInitCallback(s);
                            // 始终创建弹幕悬浮图标、保存DOM和token, 供后续 startDanMu 恢复
                            _this.initDanMuIcon();
                            _this.danMuDoc = button.ownerDocument;
                            _this.initAiDanMu(button);
                            if (resp.data.pushType == 1) {
                                _this.danMuSocketToken = resp.data.token;
                                // danMuInitCallback 返回 false 时不创建 socket 连接
                                if (danMuInit) {
                                    _this.danMuPop({ token: resp.data.token });
                                }
                            }
                        }
                        _this.channelMemberSuccess(resp, input, group, channelCodes);
                    },
                });
            },
            /* ===== 弹幕配置：localStorage 读写 / 表单回填 / 缓存 / 保存重置 ===== */
            getDanMuConfig: function () {
                var danMuConfig = this.getDanMuStorage();
                var json = {};
                try {
                    json = JSON.parse(danMuConfig);
                } catch (e) {}
                return this.extend(this.extend({}, this.settings.danMuSetting), json);
            },
            initAiDanMu: function (button) {
                var s = this.settings;
                var cfg = this.getDanMuConfig();
                // 优先从 button 向上查找; 若 button 所属面板已被替换(并发 init 竞态),
                // 回退到 button.ownerDocument 全文档查找, 保证 .main-pusher / .main-config 能定位到
                var doc = button && button.ownerDocument ? button.ownerDocument : document;
                var mainPusher = $(button).parents(".main-pusher");
                if (!mainPusher.length) {
                    mainPusher = $(doc).find(".main-pusher");
                }
                var mainConfig = $(button).parents(".main").find(".main-config");
                if (!mainConfig.length) {
                    mainConfig = $(doc).find(".main-config");
                }
                var $form = mainConfig.find("#danmuConfig form");
                // aiDanMu 统一来源: 开发者传参 / URL参数 / localStorage (getDanMuConfig 已合并; 0=关, N=间隔秒数)
                var aiOn = cfg.aiDanMu > 0;
                if (aiOn) {
                    if (this.danMuTimer) {
                        window.clearTimeout(this.danMuTimer);
                    }
                    s.danMuSetting.aiDanMu = cfg.aiDanMu;
                    $(mainPusher).find("#aiDanMuGroup").show();
                    s.checkAiDanMu(button.ownerDocument);
                } else {
                    s.danMuSetting.aiDanMu = 0;
                }
                var fields = [
                    { key: "opacity", val: cfg.opacity, type: "val" },
                    { key: "size", val: cfg.size, type: "val" },
                    { key: "speed", val: cfg.speed, type: "val" },
                    {
                        key: "close",
                        val: cfg.close != 0,
                        type: "prop",
                        attr: "checked",
                    },
                    { key: "bottom", val: cfg.bottom, type: "val" },
                    { key: "aiDanMu", val: aiOn ? cfg.aiDanMu : "", type: "val" },
                ];
                for (var i = 0; i < fields.length; i++) {
                    var f = fields[i];
                    if (f.type == "val") {
                        $form.find("input[name=" + f.key + "]").val(f.val);
                    } else {
                        $form.find("input[name=" + f.key + "]").prop(f.attr, f.val);
                    }
                }
                $form
                    .find("input[name='bottomradio'][value='0']")
                    .prop("checked", !cfg.bottomradio);
                $form
                    .find("input[name='bottomradio'][value='1']")
                    .prop("checked", !!cfg.bottomradio);
                $form.find("input[name='airadio'][value='0']").prop("checked", !aiOn);
                $form.find("input[name='airadio'][value='1']").prop("checked", aiOn);
                mainPusher.hide();
                mainConfig.show();
            },
            parallelLoadScripts: function (scripts, callback) {
                if (typeof scripts != "object") {
                    var scripts = [scripts];
                }
                var HEAD =
                    document.getElementsByTagName("head").item(0) ||
                    document.documentElement,
                    s = new Array(),
                    loaded = 0;
                for (var i = 0; i < scripts.length; i++) {
                    s[i] = document.createElement("script");
                    s[i].setAttribute("type", "text/javascript");
                    s[i].onload = s[i].onreadystatechange = function () {
                        //Attach handlers for all browsers
                        if (
                            navigator.userAgent.indexOf("MSIE") == -1 ||
                            this.readyState == "loaded" ||
                            this.readyState == "complete"
                        ) {
                            loaded++;
                            this.onload = this.onreadystatechange = null;
                            this.parentNode.removeChild(this);
                            if (loaded == scripts.length && typeof callback == "function")
                                callback();
                        }
                    };
                    s[i].setAttribute("src", scripts[i]);
                    HEAD.appendChild(s[i]);
                }
            },
            initPusherKF: function (params) {
                var s = this.settings;
                // 将当前成员的个人信息缓存到 settings, 供 sendCallback 等调用方搜集用户上下文
                if (params) {
                    if ("channelName" in params) s.channelName = params.channelName;
                    if ("uid" in params) s.uid = params.uid;
                    if ("name" in params) s.name = params.name;
                    if ("createTime" in params) s.createTime = params.createTime;
                    if ("avatar" in params) s.avatar = params.avatar;
                    if ("channelCode" in params) s.channelCode = params.channelCode;
                    if ("token" in params) s.token = params.token;
                    if ("group" in params) s.group = params.group;
                    if ("shareFlag" in params) s.shareFlag = params.shareFlag;
                }
                if (!s.configCallback) {
                    return;
                }
                var allow = s.configCallback(params);
                if (!allow || s.hideDialog) {
                    return;
                }
                if (typeof KF === "undefined") {
                    this.parallelLoadScripts(
                        [s.jsSite + "/kf.js", s.jsSite + "/layer/layer.js"],
                        function () {
                            var kf = new KF();
                            kf.init(params);
                        },
                    );
                } else {
                    var kf = new KF();
                    kf.init(params);
                }
            },
            /* ===== 弹幕核心：Socket.IO 单例连接 / 消息分发 ===== */
            danMuPop: function (params) {
                var _this = this;
                var sock = _this.danMuSocket;
                if (sock) {
                    // 同一个 token（同一通道/用户）→ 复用已有连接，直接返回
                    if (_this.danMuSocketToken === params.token) {
                        return;
                    }
                    // token 变化 → 先断开旧连接再建新的
                    try {
                        sock.removeAllListeners();
                        sock.disconnect();
                    } catch (e) {}
                    _this.danMuSocket = null;
                    _this.danMuSocketToken = null;
                }
                var so = io(_this.settings.wsUrl || "https://2120ws.phprm.com");
                _this.danMuSocket = so;
                _this.danMuSocketToken = params.token;
                // 读取弹幕配置并缓存（避免每条消息重复读取解析）
                var cfg = _this.getDanMuConfig();
                _this.updateCfgCache(cfg);
                so.on("connect", function () {
                    so.emit("login", params.token);
                });
                so.on("new_msg", function (msg) {
                    if ("undefined" != typeof console) {
                        console.log("收到弹幕消息：" + msg);
                    }
                    if (msg == null || msg.indexOf("{") != 0) {
                        return;
                    }
                    var cache = _this.cfgCache || {
                        cfg: {},
                        bottomradio: 0,
                        textLen: 40,
                    };
                    var cfg = cache.cfg;
                    var bottomradio = cache.bottomradio;
                    var textLen = cache.textLen;
                    try {
                        var message = JSON.parse(msg);
                        var chatJson = null;
                        try {
                            chatJson = JSON.parse(message.content);
                        } catch (ex) {}
                        if (chatJson && chatJson["fromId"] && chatJson["toId"]) {
                            var title = _this.cutText(chatJson.content, Math.ceil(textLen));
                            // 目前匿名用户发送的消息不存在url
                            _this.buildBarragerItem(
                                chatJson.messageId
                                    ? chatJson.messageId
                                    : chatJson.messagePushId,
                                chatJson.fromAvatar,
                                title,
                                null,
                                cfg,
                                bottomradio
                            );
                            return;
                        }
                        var title = _this.cutText(
                            _this.subByString(message.content, "✉️&nbsp;", "&nbsp;🕒"),
                            Math.ceil(textLen),
                        );
                        _this.buildBarragerItem(
                            message.messageId,
                            message.avatar,
                            title,
                            message.url,
                            cfg,
                            bottomradio
                        );
                    } catch (e) {
                        console && console.log("弹幕消息解析失败: " + e);
                    }
                });
            },
            buildBarragerItem: function (id, img, info, href, cfg, bottomradio) {
                var s = this.settings;
                var item = {
                    id: id,
                    img: img,
                    info: info,
                    like: cfg.like == 0 ? 0 : 1,
                    close: cfg.close == 0 ? 0 : 1,
                    closeText: s.closeText,
                    speed: cfg.speed ? cfg.speed : 16,
                    bottom: cfg.bottom && bottomradio ? cfg.bottom : 0,
                    size: cfg.size ? cfg.size : 20,
                    opacity: cfg.opacity ? cfg.opacity : 0,
                    color: cfg.color ? cfg.color : "#fff",
                    old_ie_color: "#000000",
                };
                if (href) {
                    item.href = href;
                }
                if (s.messageIdList && s.messageIdList.indexOf(id) !== -1) {
                    s.danMuFilterCallback(item, function (dom) {
                        s.danMuPopCallback(dom, item);
                        if (s.messageIdList.length > s.messageLength) {
                            s.messageIdList.splice(
                                0,
                                s.messageIdList.length - s.messageLength,
                            );
                        }
                    });
                    return;
                }
                s.danMuFilter(item);
            },
            buildTableRow: function (item) {
                return (
                    '<div class="table-row"><div class="todo-name" title="' +
                    item["pushDescribe"] +
                    '"><a href="' +
                    item["shareUrl"] +
                    '" target="_blank">' +
                    item["pushTitle"] +
                    '</a></div><div class="todo-button">' +
                    '<button class="todo-group btn btn-primary" data-code="' +
                    item["channelCode"] +
                    '" data-title="' +
                    item["channelName"] +
                    '" data-name="' +
                    item["nickname"] +
                    '" data-avatar="' +
                    item["avatar"] +
                    '"  data-group="' +
                    item["group"] +
                    '" data-share="' +
                    item["shareFlag"] +
                    '" data-time="' +
                    item["createTime"] +
                    '" data-uid="' +
                    item["channelMemberRelId"] +
                    '" data-token="' +
                    item["token"] +
                    '" width="105" height="35" style="cursor:pointer;">打开推送通道</button>' +
                    '</div><div class="todo-member">' +
                    (item["selfStatus"]
                        ? "我创建的" + item["memberCount"] + "人群组"
                        : item["nickname"] + "创建的" + item["memberCount"] + "人群组") +
                    "</div></div>"
                );
            },
            showDanMuMsg: function (doc, text) {
                $(doc)
                    .find("#danmuMsg")
                    .text(text)
                    .animate({ opacity: 0 }, 4000, function () {
                        $(this).text("").css("opacity", 1);
                    });
            },
            updateCfgCache: function (cfg) {
                var bottomradio = cfg.bottomradio ? cfg.bottomradio : 0;
                var textLen = 40;
                if (cfg.size) {
                    var min = cfg.size - 10;
                    textLen =
                        textLen - (min > 0 ? min : 0) < 10
                            ? 10
                            : textLen - (min > 0 ? min : 0);
                }
                this.cfgCache = {
                    cfg: cfg,
                    bottomradio: bottomradio,
                    textLen: textLen,
                };
            },
            rangeFail: function (doc, val, min, max, defVal, rangeText, inputName) {
                if (val < min || val > max) {
                    this.showDanMuMsg(doc, rangeText);
                    $(doc)
                        .find("#danmuConfig form input[name=" + inputName + "]")
                        .val(defVal);
                    return true;
                }
                return false;
            },
            subByString: function (haystack) {
                var left = "undefined" != typeof arguments[1] ? arguments[1] : "";
                var right = "undefined" != typeof arguments[2] ? arguments[2] : "";
                var left_pos = false;
                var right_pos = false;
                if (left == "" || (left_pos = haystack.indexOf(left)) === -1) {
                    var start_pos = 0;
                } else {
                    var start_pos = left_pos;
                }
                var right_data = haystack.substr(
                    start_pos + (left_pos === false ? 0 : left.length),
                );
                if (right == "" || (right_pos = right_data.indexOf(right)) === -1) {
                    return haystack.substr(left_pos === -1 ? 0 : left_pos + left.length);
                } else {
                    var end_pos = start_pos + right_pos;
                    return haystack.substr(
                        left_pos === -1 ? 0 : left_pos + left.length,
                        end_pos - start_pos,
                    );
                }
            },
            pad2: function (n) {
                return n < 10 ? "0" + n : "" + n;
            },
            pickSortedIndices: function (total, pick) {
                var arr = [];
                for (var i = 0; i < total; i++) arr.push(i);
                for (var j = arr.length - 1; j > 0; j--) {
                    var r = Math.floor(Math.random() * (j + 1));
                    var tmp = arr[j];
                    arr[j] = arr[r];
                    arr[r] = tmp;
                }
                return arr.slice(0, pick).sort(function (a, b) {
                    return a - b;
                });
            },
            splitLinesIntoGroups: function (lines, c) {
                var groups = [];
                var n = lines.length;
                if (n === 0) {
                    while (c--) groups.push("");
                    return groups;
                }
                // 分组数不超过实际行数，防止 step=0 导致所有行被塞进最后一组
                if (c > n) c = n;
                var step = Math.floor(n / c);
                var pos = 0;
                for (var k = 0; k < c; k++) {
                    var end = k === c - 1 ? n : pos + step;
                    groups.push(lines.slice(pos, end).join("\n"));
                    pos = end;
                }
                return groups;
            },
            joinPickedGroups: function (groups, pickedIdx) {
                var parts = [];
                for (var i = 0; i < pickedIdx.length; i++) {
                    parts.push(groups[pickedIdx[i]]);
                }
                return parts.join("\n");
            },
            buildAiDanMuBody: function () {
                var bodyText = document.body.innerText || "";
                var lines = bodyText.split(/\r?\n|\r/);
                var body = "";
                var cfg = [
                    { min: 0, max: 10, groups: 0, pick: 0, isTime: true },
                    { min: 10, max: 50, groups: 8, pick: 6 },
                    { min: 50, max: 100, groups: 10, pick: 5 },
                    { min: 100, max: 200, groups: 15, pick: 7 },
                    { min: 200, max: Infinity, groups: 20, pick: 5 },
                ];
                var len = lines.length;
                for (var i = 0; i < cfg.length; i++) {
                    if (len >= cfg[i].min && len < cfg[i].max) {
                        if (cfg[i].isTime) {
                            var d = new Date();
                            var timeStr =
                                "当前时间: " +
                                d.getFullYear() +
                                "/" +
                                this.pad2(d.getMonth() + 1) +
                                "/" +
                                this.pad2(d.getDate()) +
                                " " +
                                this.pad2(d.getHours()) +
                                ":" +
                                this.pad2(d.getMinutes()) +
                                ":" +
                                this.pad2(d.getSeconds());
                            body = bodyText + timeStr;
                        } else {
                            var groups = this.splitLinesIntoGroups(lines, cfg[i].groups);
                            var picked = this.pickSortedIndices(cfg[i].groups, cfg[i].pick);
                            body = this.joinPickedGroups(groups, picked);
                        }
                        break;
                    }
                }
                if (body.length > 2000) {
                    body = this.cutText(body, 2000, "");
                }
                return body;
            },
            cutText: function (str, maxLen, ellipsis) {
                if (maxLen == null) {
                    maxLen = 30;
                }
                if (ellipsis == null) {
                    ellipsis = "...";
                }
                if (!str) {
                    return "";
                }
                var chars = String(str).split("");
                if (chars.length <= maxLen) {
                    return str;
                }
                return chars.slice(0, maxLen).join("") + ellipsis;
            },
            getPusherPcUrl: function (c) {
                return (
                    c.url +
                    "?group=" +
                    c.group +
                    "&token=" +
                    c.token +
                    "&createTime=" +
                    c.createTime +
                    "&channelCode=" +
                    c.channelCode +
                    "&shareFlag=" +
                    c.shareFlag +
                    "&channelName=" +
                    c.channelName +
                    "&uid=" +
                    c.uid +
                    "&name=" +
                    c.name +
                    "&avatar=" +
                    encodeURIComponent(c.avatar)
                );
            },
            getPusherMobileUrl: function (c) {
                return (
                    c.url.replace("pc", "mobile") +
                    "?group=" +
                    c.group +
                    "&token=" +
                    c.token +
                    "&createTime=" +
                    c.createTime +
                    "&channelCode=" +
                    c.channelCode +
                    "&shareFlag=" +
                    c.shareFlag +
                    "&channelName=" +
                    c.channelName +
                    "&uid=" +
                    c.uid +
                    "&name=" +
                    c.name +
                    "&avatar=" +
                    encodeURIComponent(c.avatar)
                );
            },
            addChannelInput: function (button, channelCode) {
                var _this = this;
                var input = $(button).parents(".channel-input");
                // 判重: 传入了channelCode且已存在于任一输入框时, 不重复新增(并高亮已有输入框提醒用户)
                if (channelCode) {
                    var $exists = input
                        .find("input[name='channelCode']")
                        .filter(function () {
                            return $(this).val() === channelCode;
                        })
                        .first();
                    if ($exists.length) {
                        return;
                    }
                }
                var html =
                    '<div class="channel-group">' +
                    '<span style="clear:both;position:relative;"><input type="text" class="serchpt channelCode" value="' +
                    (channelCode ? channelCode : "") +
                    '" name="channelCode" spellcheck="false" placeholder="通道码/口令"/></span>' +
                    '<span class="pusher-button">' +
                    '<button class="btn btn-primary" width="105" height="35" style="cursor:pointer;">打开推送通道</button>' +
                    "</span></div>";
                var len = input.find(".channel-group").length;
                if (len > 5) {
                    input.find(".channel-group").eq(0).remove();
                }
                input.parent().find(".footer").hide();
                $(html).insertBefore($(button).parent());
                input
                    .find(".channel-group:last")
                    .find(".pusher-button")
                    .click(function () {
                        _this.openPusherDialog(this);
                    });
            },
            closePusher: function (skipResetInited) {
                // 单例标志复位: 用户主动关闭后允许再次 init; 内部清理调用时跳过复位
                if (!skipResetInited) {
                    this._initedAppName = null;
                }
                // 1) 先停 AI 弹幕轮询定时器，防止关闭后回调访问已销毁的 iframe/doc
                if (this.danMuTimer) {
                    window.clearTimeout(this.danMuTimer);
                    this.danMuTimer = null;
                }
                // 2) 断开弹幕 Socket.IO 连接，清理监听器与令牌
                if (this.danMuSocket) {
                    try {
                        this.danMuSocket.removeAllListeners();
                        this.danMuSocket.disconnect();
                    } catch (e) {}
                    this.danMuSocket = null;
                    this.danMuSocketToken = null;
                }
                // 3) 最后移除 DOM（避免清理过程中资源事件继续投递到已删除节点）
                $("#pushWebAnonymous").remove();
                // 4) 移除弹幕悬浮图标
                $("#pushWebDanIcon").remove();
                // 5) 清除页面上所有滚动的弹幕
                $(".barrage").remove();
                // 6) 清空弹幕去重缓存(缓存挂在 settings 上, 因 danMuFilterCallback 内 this===settings),
                //    避免下次初始化时旧id误判为重复
                this.settings.danMuSeenIds = null;
                this.settings.danMuSeenCount = 0;
                // 7) 清除 startDanMu 所需的重启上下文(token/doc), 防止面板销毁后误用
                this.danMuDoc = null;
                // 8) 清除显隐/暂停/区域 API 注入的样式和容器
                $("#pushWebDanMuHideStyle").remove();
                $("#pushWebDanMuAreaStyle").remove();
                $("#pushWebDanMuArea").remove();
                this.settings.danMuPaused = false;
                this.settings.danMuQueue = null;
                this.settings.danMuSetting.selector = "body";
            },
            /**
             * 停止弹幕: 断开 Socket.IO、停止 AI 弹幕轮询、清除屏幕弹幕。
             * 保留 danMuSocketToken 和 danMuDoc 供 startDanMu 恢复, 不影响面板和图标。
             * 适用场景: 开发者在页面上放置弹幕开关, 关闭时调用。
             */
            stopDanMu: function () {
                var _this = this;
                // 1) 停止 AI 弹幕轮询定时器
                if (_this.danMuTimer) {
                    window.clearTimeout(_this.danMuTimer);
                    _this.danMuTimer = null;
                }
                // 2) 断开 Socket.IO 连接, 清理监听器(保留 danMuSocketToken 供恢复)
                if (_this.danMuSocket) {
                    try {
                        _this.danMuSocket.removeAllListeners();
                        _this.danMuSocket.disconnect();
                    } catch (e) {}
                    _this.danMuSocket = null;
                }
                // 3) 清除屏幕上所有滚动弹幕
                $(".barrage").remove();
                return true;
            },
            /**
             * 启动弹幕: 恢复 Socket.IO 监听、重启 AI 弹幕轮询。
             * 依赖 stopDanMu 之前保存的 danMuSocketToken 和 danMuDoc。
             * 适用场景: 开发者在页面上放置弹幕开关, 开启时调用。
             */
            startDanMu: function () {
                var _this = this;
                var s = _this.settings;
                // 未初始化或面板已关闭(token 被清空)→ 无法启动
                if (!_this.danMuSocketToken) {
                    return false;
                }
                // 1) 重连 Socket.IO (danMuPop 内部处理: 无连接时新建, 已连接同 token 复用)
                _this.danMuPop({ token: _this.danMuSocketToken });
                // 2) 重启 AI 弹幕轮询 (checkAiDanMu 内部判断 aiDanMu>0 才轮询)
                if (s.danMu == 1 && s.danMuSetting.aiDanMu > 0 && _this.danMuDoc) {
                    s.checkAiDanMu(_this.danMuDoc, 1);
                }
                return true;
            },
            /**
             * 更新弹幕配置并立即生效。
             * 传入 danMuSetting 的部分字段, 自动合并到 settings.danMuSetting、localStorage、cfgCache,
             * 使新配置对后续弹幕立即生效; aiDanMu 变化时自动启停 AI 轮询。
             * @param {object} options - danMuSetting 字段子集, 如 {opacity:80, aiDanMu:10}
             */
            updateDanMu: function (options) {
                var _this = this;
                var s = _this.settings;
                options = options || {};
                // 记录变更前的 aiDanMu, 用于判断是否需要重启轮询
                var prevAi = parseInt(s.danMuSetting.aiDanMu) || 0;
                // 1) 深合并到 settings.danMuSetting
                _this.extend(s.danMuSetting, options);
                // 归一化 aiDanMu 为数字
                var newAi = parseInt(s.danMuSetting.aiDanMu) || 0;
                s.danMuSetting.aiDanMu = newAi;
                // 2) 同步到 localStorage, 否则 getDanMuConfig 的 localStorage 旧值会覆盖 danMuSetting
                var stored = {};
                try {
                    stored = JSON.parse(_this.getDanMuStorage()) || {};
                } catch (e) {}
                _this.extend(stored, options);
                // localStorage 同样归一化 aiDanMu
                stored.aiDanMu = newAi;
                _this.setDanMuStorage(JSON.stringify(stored));
                // 3) 重建 cfgCache, 使外观配置(opacity/size/speed/color/bottom 等)立即对后续弹幕生效
                var cfg = _this.getDanMuConfig();
                _this.updateCfgCache(cfg);
                // 4) aiDanMu 变化时启动或停止 AI 轮询
                if (newAi > 0) {
                    // 间隔变化或之前未在轮询 → 启动; 未变且正在轮询 → 不重启(保留 pollCount)
                    if (newAi !== prevAi || !_this.danMuTimer) {
                        if (_this.danMuDoc) {
                            s.checkAiDanMu(_this.danMuDoc, 1);
                        }
                    }
                } else {
                    // aiDanMu=0 → 停止轮询
                    if (_this.danMuTimer) {
                        window.clearTimeout(_this.danMuTimer);
                        _this.danMuTimer = null;
                    }
                }
            },
            /**
             * 隐藏弹幕: 所有 .barrage 元素变为不可见, 但动画继续运行(不丢消息)。
             * 用 visibility:hidden 而非 display:none, 避免 jQuery .animate() 位置计算异常。
             */
            hideDanMu: function () {
                if (!$("#pushWebDanMuHideStyle").length) {
                    var style = document.createElement("style");
                    style.id = "pushWebDanMuHideStyle";
                    style.innerHTML = ".barrage{visibility:hidden !important;}";
                    document.head.appendChild(style);
                }
            },
            /**
             * 显示弹幕: 移除 hideDanMu 注入的 CSS, 弹幕恢复可见。
             */
            showDanMu: function () {
                $("#pushWebDanMuHideStyle").remove();
            },
            /**
             * 清屏: 移除当前所有弹幕元素(含可见区域外和暂停队列),
             * 不影响 Socket.IO 连接、AI 轮询、面板和图标。
             */
            clearDanMu: function () {
                // 1) 移除 DOM 上所有弹幕(无论挂在 body 还是 #pushWebDanMuArea 容器内)
                $(".barrage").remove();
                // 2) 清空暂停期间暂存的消息队列, 避免恢复后重新弹出已清除的内容
                this.settings.danMuQueue = null;
            },
            /**
             * 主动发送弹幕(这里仅发送到当前屏幕)，如需审核存储后再推送, 请在sendCallback回调中异步请求业务方后端, 再由后端进行推送给其他人。
             * 复用 danMuFilter → danMuFilterCallback 链路, 自动应用去重、info空白校验、暂停队列、配置合并。
             * 渲染完成后(或因去重/空白被拦截后)调用 sendCallback(item, settings) 回传。
             * @param {object} rawItem  弹幕内容, 支持字段: info(必填,文本) / id(可选,缺省自动生成) /
             *                          img(头像) / href(跳转链接) / like / close / closeText /
             *                          speed / bottom / size / opacity / color / num(点赞数)
             * @returns {boolean}  true=进入渲染链路, false=info为空或被去重拦截
             */
            sendDanMu: function (rawItem) {
                var _this = this;
                var s = _this.settings;
                var dms = s.danMuSetting;
                rawItem = rawItem || {};
                // 生成局部 id: 用 "local_" + 时间戳 + 随机数, 避免与推送来的真实 messageId 冲突
                var item = {
                    id:
                        rawItem.id != null && String(rawItem.id) !== ""
                            ? rawItem.id
                            : "local_" +
                            Date.now() +
                            "_" +
                            Math.floor(Math.random() * 10000),
                    info: rawItem.info != null ? rawItem.info : "",
                    img: rawItem.img || "",
                    href: rawItem.href || "",
                    like: typeof rawItem.like !== "undefined" ? (rawItem.like == 0 ? 0 : 1) : (dms.like == 0 ? 0 : 1),
                    close: typeof rawItem.close !== "undefined" ? (rawItem.close == 0 ? 0 : 1) : (dms.close == 0 ? 0 : 1),
                    closeText: rawItem.closeText || s.closeText,
                    speed: rawItem.speed || dms.speed || 16,
                    bottom: rawItem.bottom || (dms.bottomradio ? (dms.bottom || 0) : 0),
                    size: rawItem.size || dms.size || 20,
                    opacity: typeof rawItem.opacity !== "undefined" ? rawItem.opacity : dms.opacity || 0,
                    color: rawItem.color || dms.color || "#fff",
                    old_ie_color: rawItem.old_ie_color || "#000000",
                    num: parseInt(rawItem.num) || 0
                };
                // 渲染是否真正执行(没被去重/空白拦住)
                var rendered = false;
                try {
                    // 直接调用 danMuFilterCallback(跳过 danMuFilter 的 num=0 覆盖), this===settings 正确
                    // 去重/info空白/暂停队列全部在 danMuFilterCallback 内处理
                    s.danMuFilterCallback.call(s, item, function (dom) {
                        s.danMuPopCallback(dom, item);
                        rendered = true;
                    });
                } catch (e) {
                    rendered = false;
                }
                // 无论是否成功渲染, 都调用 settings.sendCallback(item, settings) 回传
                // 第二个参数 settings 含 channelName/uid/name/createTime/avatar/channelCode/token/group/shareFlag/
                // device/screenResolution/userPlatformType/userPlatformVersion 等用户上下文
                if (s.sendCallback && typeof s.sendCallback === "function") {
                    s.sendCallback(item, s);
                }
                return rendered;
            },
            /**
             * 暂停弹幕: 停止所有 .barrage 的 jQuery 动画(冻结在当前位置),
             * 新到达的消息暂存到队列, resumeDanMu 时统一渲染。
             */
            pauseDanMu: function () {
                var s = this.settings;
                $(".barrage").stop(true);
                s.danMuPaused = true;
            },
            /**
             * 恢复弹幕: 重启冻结的 .barrage 动画 + 刷新暂停期间暂存的消息队列。
             */
            resumeDanMu: function () {
                var _this = this;
                var s = _this.settings;
                s.danMuPaused = false;
                // 1) 重启冻结的弹幕动画 (barrager.js 用 jQuery .animate, .stop(true) 后需手动恢复)
                var speed = (s.danMuSetting.speed ? s.danMuSetting.speed : 16) * 1000;
                var targetRight = $(window).width() + 500;
                var totalDist = targetRight + 500; // 起点right=-500, 终点right=window+500
                $(".barrage").each(function () {
                    var $el = $(this);
                    var curRight = parseInt($el.css("right")) || -500;
                    if (curRight < targetRight) {
                        var remain = targetRight - curRight;
                        var dur = Math.max(1000, (remain / totalDist) * speed);
                        $el.animate({ right: targetRight }, dur, function () {
                            $(this).remove();
                        });
                    } else {
                        $el.remove();
                    }
                });
                // 2) 刷新暂停期间暂存的消息队列
                if (s.danMuQueue && s.danMuQueue.length) {
                    var queue = s.danMuQueue;
                    s.danMuQueue = [];
                    for (var i = 0; i < queue.length; i++) {
                        var entry = queue[i];
                        entry.callback(entry.dom, entry.item);
                        $(entry.dom).barrager(entry.item);
                    }
                }
            },
            /**
             * 设置弹幕显示区域比例。
             * 创建一个 fixed 定位、overflow:hidden 的容器作为弹幕挂载节点,
             * 并将 .barrage 从 position:fixed 改为 position:absolute 使其受容器裁剪。
             * @param {number} ratio  0.1~1, 如 0.5=只在上半屏显示弹幕; 1=全屏(恢复默认)
             */
            setDanMuArea: function (ratio) {
                var _this = this;
                var s = _this.settings;
                ratio = Math.max(0.1, Math.min(1, parseFloat(ratio) || 1));
                var height = Math.round($(window).height() * ratio);
                var $container = $("#pushWebDanMuArea");
                if (!$container.length) {
                    $container = $("<div id='pushWebDanMuArea'></div>")
                        .css({
                            position: "fixed",
                            top: "0",
                            left: "0",
                            width: "100%",
                            overflow: "hidden",
                            "pointer-events": "none",
                            "z-index": "99998",
                        })
                        .appendTo("body");
                    // 容器内 .barrage 改为 absolute, 使其受 overflow:hidden 裁剪
                    $(
                        "<style id='pushWebDanMuAreaStyle'>#pushWebDanMuArea .barrage{position:absolute !important;pointer-events:auto !important;}</style>",
                    ).appendTo("head");
                    s.danMuSetting.selector = "#pushWebDanMuArea";
                }
                $container.css("height", height + "px");
                // ratio=1 时恢复默认 body 挂载
                if (ratio >= 1) {
                    s.danMuSetting.selector = "body";
                }
            },
            initDanMuIcon: function () {
                var _this = this;
                // hideIcon=1时不创建右下角浮窗图标, 但不影响弹幕推送、面板等其他功能
                if (_this.settings.danMuSetting.hideIcon == 1) {
                    return;
                }
                if ($("#pushWebDanIcon").length) {
                    return;
                }
                var icon = document.createElement("div");
                icon.id = "pushWebDanIcon";
                // 外层透明容器扩大 hover 区域，覆盖 dan.png(37x25) 和 4.gif(右上角外延20px)
                // right:-2 bottom:20 width:57 height:45 保持 dan.png 和 4.gif 视觉位置与之前一致
                icon.style.cssText =
                    "position:fixed; right:-2px; bottom:20px; z-index:2147483647; width:57px; height:45px; cursor:pointer;";
                // dan.png 背景放在内层 div，定位在容器右下角；4.gif 在容器右上角
                icon.innerHTML =
                    '<div class="dan-icon-img" style="position:absolute; right:20px; top:20px; width:37px; height:25px; background:url(' +
                    _this.settings.cssSite +
                    'images/dan.png) no-repeat 0 0;"></div>' +
                    '<img src="' +
                    _this.settings.cssSite +
                    'images/4.gif" style="position:absolute; right:0; top:0; cursor:pointer; display:none;" class="dan-close-btn" />';
                document.body.appendChild(icon);
                // hover 绑在外层，鼠标在 dan.png 或 4.gif 上都触发橙色+显示关闭按钮
                $(icon).hover(
                    function () {
                        $(this).find(".dan-icon-img").css("background-position", "0 100%");
                        $(this).find(".dan-close-btn").show();
                    },
                    function () {
                        $(this).find(".dan-icon-img").css("background-position", "0 0");
                        $(this).find(".dan-close-btn").hide();
                    },
                );
                $(icon)
                    .find(".dan-close-btn")
                    .click(function (e) {
                        e.stopPropagation();
                        $(icon).hide();
                        return false;
                    });
                $(icon).click(function (e) {
                    if ($(e.target).hasClass("dan-close-btn")) return;
                    var s = _this.settings;
                    if (s.danMuSendOpened) {
                        s.danMuSendOpened = false;
                        if (typeof s.danMuSendClose === "function") {
                            s.danMuSendClose(s);
                        }
                    } else {
                        s.danMuSendOpened = true;
                        if (typeof s.danMuSendOpen === "function") {
                            s.danMuSendOpen(s);
                        }
                    }
                });
                // 控制面板初始化完毕后闪烁3次吸引注意：灰色→橙色→灰色，每次1秒
                var $flashImg = $(icon).find(".dan-icon-img");
                var flashCount = 0;
                var flashMax = 3;
                var flashStep = function () {
                    if (flashCount >= flashMax) {
                        $flashImg.css("background-position", "0 0");
                        return;
                    }
                    flashCount++;
                    $flashImg.css("background-position", "0 100%");
                    setTimeout(function () {
                        $flashImg.css("background-position", "0 0");
                        setTimeout(flashStep, 500);
                    }, 500);
                };
                setTimeout(flashStep, 500);
            },
            togglePusherPanel: function () {
                var $panel = $("#pushWebAnonymous");
                if ($panel.length === 0) {
                    return;
                }
                var el = $panel[0];
                var inst = $panel.data("bg_move");
                var isHidden = el.style.display === "none";
                if (!isHidden && inst) {
                    // 可见但可能被吸边（style.left 在屏幕外）
                    var inlineLeft = el.style.left;
                    if (inlineLeft) {
                        var parsed = parseInt(inlineLeft);
                        if (
                            parsed < 0 ||
                            parsed > $(window).width() - $panel.outerWidth()
                        ) {
                            isHidden = true;
                        }
                    }
                }
                if (isHidden) {
                    $panel.show();
                    if (inst) {
                        inst.restore();
                    }
                } else {
                    if (inst) {
                        inst.right_animate();
                    } else {
                        $panel.hide();
                    }
                }
            },
            closeLogin: function () {
                $("#pushWeblogin").remove();
            },
            startLogin: function (button) {
                var _this = this;
                var mainLogin = $(button).parents(".main-login");
                var obj = {
                    field: {
                        grant_type: "password",
                        scope: "server",
                        type: "username",
                        mobile: "1",
                        username: mainLogin.find("#txtEmail").val(),
                        password: mainLogin.find("#txtPassword").val(),
                        code: mainLogin.find("#verifyCode").val(),
                        randomStr: mainLogin.find("#randomStr").val()
                    },
                    node: mainLogin,
                };
                this.usernameLogin(obj, function (resp) {
                    if (resp.code != 0) {
                        if (resp.message) {
                            console && console.log(resp.message);
                        }
                        mainLogin.find("#loginMsg").text(resp.message);
                        return;
                    }
                    var data = resp.data;
                    if (!data || !data["appKey"]) {
                        mainLogin
                            .find("#loginMsg")
                            .text("登录失败, 请点击下方忘记密码连接登录或者找回密码");
                        return;
                    }
                    var chkRemember = mainLogin.find("#chkRemember").prop("checked");
                    _this.storeUserInfo("appKey", data["appKey"], chkRemember);
                    _this.loginSuccess(mainLogin);
                });
            },
            loginSuccess: function (mainLogin) {
                if (mainLogin.length == 0) {
                    return;
                }
                var _this = this;
                mainLogin.find("#divLogin").hide();
                mainLogin.find("#divTodo").show();
                mainLogin.find("#logoutButton").show();
                var appKey = this.getUserInfo("appKey");
                var headers = _this.getSignHeaders();
                var params = {
                    type: "getMyWebsitePluginRelByTag",
                    appKey: appKey,
                    pid: 0,
                    _t: headers["apiTimestamp"],
                    page: 1,
                    limit: 5
                };
                _this.loadPage(params, headers, function (resp) {
                    if (resp.code != 0) {
                        mainLogin.find("#todoMsg").text(resp.message);
                        return;
                    }
                    var data = resp["data"];
                    var r = data["records"];
                    // 分页区公共前缀: form-button容器 + 加载更多按钮 + noMore开头标签
                    var pagerHead =
                        '</div><div class="form-button">\n' +
                        '<input type="button" id="loadMore" value="加载更多通道" class="load-button btn" />\n' +
                        '<span id="noMore" class="no-more">';
                    var html = "";
                    for (var i = 0; i < r.length; i++) {
                        html += _this.buildTableRow(r[i]);
                    }
                    if (data["totalPage"] > 1) {
                        html += pagerHead + "没有更多了</span>\n</div>";
                    } else if (data["totalPage"] == 0) {
                        html +=
                            pagerHead +
                            '还没创建过任何提醒，<a href="' +
                            _this.settings.apiUrl.replace("/app/api/getDataInfo", "") +
                            '" class="nav-button" target="_blank">去创建提醒</a></span>\n' +
                            "</div>";
                    } else {
                        html += "</div>";
                    }
                    mainLogin.find(".table-todo").html('<div class="table-body">' + html);
                    if (data["totalPage"] == 0) {
                        mainLogin.find("#loadMore").hide();
                        mainLogin.find("#noMore").show();
                    }
                    mainLogin.delegate(".todo-group", "click", function () {
                        var $btn = $(this);
                        var params = {
                            url: _this.settings.pcUrl,
                            channelName: $btn.data("title"),
                            uid: $btn.data("uid"),
                            createTime: $btn.data("time"),
                            name: $btn.data("name"),
                            avatar: $btn.data("avatar"),
                            group: $btn.data("group"),
                            channelCode: $btn.data("code"),
                            token: $btn.data("token"),
                            shareFlag: $btn.data("share")
                        };
                        _this.initPusherKF(params);
                    });

                    mainLogin.find("#loadMore").click(function () {
                        params.page = params.page + 1;
                        _this.loadPage(params, headers, function (resp) {
                            if (resp.code != 0) {
                                mainLogin.find("#todoMsg").text(resp.message);
                                return;
                            }
                            var data = resp["data"];
                            var r = data["records"];
                            var html = "";
                            for (var i = 0; i < r.length; i++) {
                                html += _this.buildTableRow(r[i]);
                            }
                            if (
                                r.length < params.limit ||
                                data["current"] == data["totalPage"]
                            ) {
                                mainLogin.find("#loadMore").hide();
                                mainLogin.find("#noMore").show();
                            }
                            var $tb = mainLogin.find(".table-body");
                            $tb.append(html);
                            try {
                                $tb.scrollTop($tb.prop("scrollHeight"));
                            } catch (e) {}
                        });
                    });
                });
            },
            /* GET + JSON + withCredentials 的公共请求 */
            ajaxGet: function (url, data, headers, onSuccess, onError, extra) {
                var opt = {
                    url: url,
                    type: "GET",
                    data: data,
                    headers: headers,
                    dataType: "json",
                    xhrFields: { withCredentials: true },
                    crossDomain: true,
                    success: onSuccess,
                    error: onError
                };
                if (extra) {
                    for (var k in extra) opt[k] = extra[k];
                }
                $.ajax(opt);
            },
            loadPage: function (params, headers, callback) {
                var _this = this;
                _this.ajaxGet(
                    _this.settings.apiUrl,
                    params,
                    headers,
                    function (response) {
                        if (callback) {
                            callback(response);
                        }
                    },
                    function () {
                        if (callback) {
                            callback({
                                code: -1,
                                message: "加载提醒列表失败,请前往官网查看",
                            });
                        }
                    }
                );
            },
            usernameLogin: function (obj, callback) {
                var _this = this;
                $.ajax({
                    url: this.settings.authUrl + "/mobile/token/form",
                    data: obj.field,
                    type: "POST",
                    headers: {
                        Authorization:
                            "Basic cWM5OGw3dGF3dmZzem9jZjpwbjFrb3drMTBhaml3Mno5dnJkcGh3YXFnNXowdTBuZg==",
                    },
                    dataType: "json",
                    xhrFields: {
                        withCredentials: true,
                    },
                    crossDomain: true,
                    success: function (resp) {
                        _this.refreshRandomStr(obj.node);
                        if (!resp.access_token) {
                            obj.node.find("#loginMsg").text(resp.message);
                            return;
                        }
                        var headers = _this.getSignHeaders();
                        _this.ajaxGet(
                            _this.settings.apiUrl,
                            {
                                type: "checkLoginCode",
                                appKey: "pushBookmark",
                                code: obj.field.randomStr,
                                _t: headers["apiTimestamp"],
                            },
                            headers,
                            function (response) {
                                if (callback) {
                                    callback(response);
                                }
                            },
                            function () {}
                        );
                    },
                    error: function (resp) {
                        obj.node.find("#loginMsg").text("登录失败, 请使用匿名推送");
                    }
                });
            },
            /* ===== 工具方法：签名 / Cookie / URL / 文本 / 脚本加载 ===== */
            getSignHeaders: function () {
                var apiTimestamp = new Date().getTime();
                var apiNonce = hex_md5(Math.random());
                var rawText =
                    apiTimestamp + "#" + this.settings.apiKey + "#" + apiNonce;
                var apiSign = hex_md5(rawText);
                return {
                    apiTimestamp: apiTimestamp,
                    apiNonce: apiNonce,
                    apiSign: apiSign
                };
            },
            buildLoginWindowHtml: function (randomStr) {
                var s = this.settings;
                return (
                    "<!DOCTYPE html><html>" +
                    "<head>" +
                    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />' +
                    "<title></title>" +
                    '<link href="' +
                    s.cssSite +
                    'pusher.css" rel="stylesheet" type="text/css" />' +
                    "</head>" +
                    '<body style="margin:0px;padding:0px">' +
                    '<div class="main">' +
                    '<div class="main-login" style="display: none">' +
                    '<div id="divLogin" class="login">' +
                    '<div style="height:33px">' +
                    '<div class="lf" style="padding-top:8px"><img src="' +
                    s.cssSite +
                    'images/7.gif"></div>' +
                    '<div class="rt lan360" style="padding-top:8px"></div>' +
                    "</div>" +
                    '<div id="loginMsg" class="msg"></div>' +
                    '<div class="login-group">' +
                    '<div class="form-group">' +
                    '<input id="txtEmail" type="text" class="username" placeholder="注册邮箱"/>' +
                    "</div>" +
                    '<div style="clear:both;height:54px;position:relative">' +
                    '<input type="password" style="color:#272727;" class="login-pwd" id="txtPassword" placeholder="密码"/>' +
                    "</div>" +
                    '<div style="clear:both;height:54px;position:relative">' +
                    '				<input type="code" placeholder="验证码" class="login-verify" id="verifyCode"/>' +
                    '<div class="login-captcha"><input id="randomStr" type="hidden" value="' +
                    randomStr +
                    '"/><span><img class="random-code" src="' +
                    s.authUrl +
                    "/draw/captcha/image?randomStr=" +
                    randomStr +
                    '"/></span></div>' +
                    "</div>" +
                    '<div class="login-button"><table border="0" cellpadding="0" cellspacing="0">' +
                    "<tbody><tr>" +
                    '					<td width="28"><input id="chkRemember" value="" type="checkbox" checked/></td>' +
                    '					<td width="117"><label for="chkRemember" title="此次登录后，只要您不点击“退出”，一周内再访问本网站时，系统将自动为您保持登录状态。">下次自动登录</label></td>' +
                    '					<td class="lan360" width="118" style=" text-align:right;">' +
                    '						<a href="' +
                    s.pushUrl +
                    "/api_user_user_forget.html?callback=" +
                    encodeURIComponent(window.location.href) +
                    '" target="_blank">忘记密码?</a>' +
                    "					</td>" +
                    "						</tr>" +
                    "				</tbody></table>" +
                    "			</div>" +
                    "			<div>" +
                    '				<img src="' +
                    s.cssSite +
                    'images/8.gif" width="259" height="36" style="cursor:pointer;" id="btnLogin"/>' +
                    "			</div>" +
                    '<div style=" text-align:center; padding-top:25px; height:38px;"><img src="' +
                    s.cssSite +
                    'images/26.gif" width="434" height="7" /></div>' +
                    "</div>" +
                    "</div>" +
                    '<div id="divTodo" class="todo-container" style="display:none">' +
                    '<div style="height:33px">' +
                    '<div class="lf" style="padding-top:8px">我的消息提醒列表</div>' +
                    '<div class="rt lan360" style="padding-top:8px"></div>' +
                    "</div>" +
                    '<div id="todoMsg" class="msg"></div>' +
                    '<div class="table-todo"></div>' +
                    '<div id="channelMore">' +
                    '<div style="text-align:center; padding-top:25px; height:38px;"><img src="' +
                    s.cssSite +
                    'images/26.gif" width="434" height="7" /></div>' +
                    "</div>" +
                    "</div>" +
                    '<div style=" text-align:center; height:38px;">' +
                    '<div class="footer">' +
                    '<a href="javascript:void(0)" class="nav-button" id="anonymousButton" target="_self">匿名推送</a>' +
                    '<a href="javascript:void(0)" class="nav-button" id="logoutButton" style="display:none" target="_self">退出登录</a>' +
                    "</div>" +
                    "</div>" +
                    "</div>" +
                    "</div></body></html>"
                );
            },
            unlogin: function (button) {
                var _this = this;
                _this.closePusher();
                _this.closeLogin();
                this.buildPanel(
                    "pushWeblogin",
                    '<div style="width:470px;padding:0px;" id="pushWebloginContent" class="ydnwc-dialog"><div id="viewLogin" style="width:470px;height:490px;"></div></div>',
                    function () {
                        _this.closeLogin();
                    },
                );
                var loginHtml =
                    "<iframe frameborder='0' src=\"javascript:void((function(){var d=document;d.open();document.domain='" +
                    document.domain +
                    "';d.write('');d.close()})())\" scrolling='no' width='470' height='490' id='loginIframe' allowtransparency></iframe>";
                $("#viewLogin").html(loginHtml);
                var loginFrame = $("#loginIframe")[0];
                var randomStr = _this.randomCode(4, true);
                try {
                    var doc = loginFrame.contentWindow.document;
                    var $doc = $(doc);
                    doc.open();
                    var html = _this.buildLoginWindowHtml(randomStr);
                    doc.write(html);
                    doc.close();

                    $doc.find("#loading").text("正在加载中...");
                    $doc.find(".main").fadeIn(100, function () {
                        $doc.find("#loading").hide();
                        $(loginFrame.contentWindow).load(function () {
                            $doc.find(".main-login").fadeIn(100);
                        });
                    });

                    $doc.find("#logoutButton").click(function () {
                        _this.logout(this);
                    });
                    $doc.find("#anonymousButton").click(function () {
                        _this.initPusherWindow(false);
                    });
                    $doc.find(".pusher-close-btn").click(function () {
                        _this.closeLogin(this);
                    });
                    $doc.find("#btnLogin").click(function () {
                        _this.startLogin(this);
                    });
                    $doc.find(".login-captcha").click(function () {
                        _this.refreshRandomStr(this);
                    });
                    _this.checkLoginStatus(doc, function (resp) {
                        var data = resp.data;
                        if (data && data["userInfo"]) {
                            $doc
                                .find(".loginButton")
                                .text("用户" + data["nickname"] + "已登录");
                            _this.loginSuccess($doc.find(".main-login"));
                        } else {
                            _this.logout($doc.find("#logoutButton").get(0));
                        }
                    });
                } catch (err) {
                    console && console.log(err);
                }
            },
            refreshRandomStr: function (button) {
                var _this = this;
                var randomStr = _this.randomCode(4, true);
                $(button).find("#randomStr").val(randomStr);
                $(button)
                    .find(".random-code")
                    .attr(
                        "src",
                        _this.settings.authUrl +
                        "/draw/captcha/image?randomStr=" +
                        randomStr,
                    );
            },
            logout: function (button) {
                var mainLogin = $(button).parents(".main-login");
                this.storeUserInfo("appKey", "", -1);
                mainLogin.find("#logoutButton").hide();
                mainLogin.find("#divTodo").hide();
                mainLogin.find("#divLogin").show();
                mainLogin.find("#anonymousButton").show();
            },
            randomCode: function (len, date) {
                var random = Math.ceil(Math.random() * 100000000000000)
                    .toString()
                    .substr(0, len || 4);
                if (date) {
                    random = random + Date.now();
                }
                return random;
            },
            getUserInfo: function (name) {
                return this.cookieGet(name);
            },
            storeUserInfo: function (name, value, chkRemember) {
                // cookieSet 第三参为天: -1=立即过期(删除), 勾选记住=30天, 否则2小时(2/24)
                if (chkRemember == -1) {
                    this.cookieSet(name, value, -1);
                } else if (chkRemember == true) {
                    this.cookieSet(name, value, 30);
                } else {
                    this.cookieSet(name, value, 2 / 24);
                }
            },
            DK: "pusher_danmu_config",
            /* 弹幕配置持久化: 优先 localStorage; 不可用时回退 cookie */
            getDanMuStorage: function () {
                try {
                    if (window.localStorage) {
                        return window.localStorage.getItem(this.DK) || "";
                    }
                } catch (e) {}
                return this.cookieGet(this.DK);
            },
            setDanMuStorage: function (value) {
                var ok = false;
                try {
                    if (window.localStorage) {
                        window.localStorage.setItem(this.DK, value);
                        ok = true;
                    }
                } catch (e) {}
                if (!ok) {
                    this.cookieSet(this.DK, value, 365);
                }
            },
            removeDanMuStorage: function () {
                try {
                    if (window.localStorage) {
                        window.localStorage.removeItem(this.DK);
                    }
                } catch (e) {}
                this.cookieSet(this.DK, "", -1);
            },
            cookieGet: function (name) {
                var prefix = name + "=";
                var ca = document.cookie.split(";");
                for (var i = 0; i < ca.length; i++) {
                    var c = ca[i].replace(/^\s+/, "");
                    if (c.indexOf(prefix) === 0) {
                        try {
                            return decodeURIComponent(c.substring(prefix.length));
                        } catch (e) {
                            return "";
                        }
                    }
                }
                return "";
            },
            cookieSet: function (name, value, days) {
                var exp = "";
                if (typeof days === "number") {
                    var d = new Date();
                    d.setTime(d.getTime() + days * 86400000);
                    exp = ";expires=" + d.toGMTString();
                }
                document.cookie =
                    name + "=" + encodeURIComponent(value) + exp + ";path=/";
            },
            extend: function (destination, source) {
                var toString = Object.prototype.toString;
                for (var property in source) {
                    var sv = source[property];
                    var dv = destination[property];
                    // 双方均为纯对象时深合并, 使 options.danMuSetting 等嵌套配置按字段并入默认值而非整体覆盖;
                    // 数组/null/非对象仍整体赋值
                    if (
                        sv !== null &&
                        dv !== null &&
                        typeof sv === "object" &&
                        typeof dv === "object" &&
                        toString.call(sv) === "[object Object]" &&
                        toString.call(dv) === "[object Object]"
                    ) {
                        this.extend(dv, sv);
                    } else {
                        destination[property] = sv;
                    }
                }
                return destination;
            },
            init: function () {
                var _this = this;
                var options = arguments[0] || {};
                var appName = options.appName || "";
                // 单例保护: 同一appName重复调用直接返回; 不同appName允许重新初始化(创建不同实例)
                if (appName && _this._initedAppName === appName) {
                    return;
                }
                // 递增初始化版本号: 让异步回调(Fingerprint2等)检测是否已被更新的 init 取代,
                // 避免旧 init 的异步回调在新 init 之后执行, 把新 init 创建的面板 closePusher 掉
                _this._initGen = (_this._initGen || 0) + 1;
                var myGen = _this._initGen;
                if (appName) {
                    _this._initedAppName = appName;
                }
                _this.initSetting(options, function () {
                    // 已有更新的 init 执行过, 放弃本次回调
                    if (_this._initGen !== myGen) {
                        return;
                    }
                    _this.styleIframe();
                    // 传入本次 init 的 channelCode, 避免并发 init 覆盖共享 s.channelCode 导致重复请求
                    _this.initPusherWindow(true, options.channelCode);
                });
            },
            /**
             * 销毁: 释放所有资源, 清理 DOM、事件、Socket.IO、定时器、缓存。
             * 销毁后可重新调用 init() 初始化。
             */
            destroy: function () {
                var _this = this;
                // 1) 停止 AI 弹幕轮询定时器
                if (_this.danMuTimer) {
                    window.clearTimeout(_this.danMuTimer);
                    _this.danMuTimer = null;
                }
                // 2) 断开 Socket.IO 连接
                if (_this.danMuSocket) {
                    try {
                        _this.danMuSocket.removeAllListeners();
                        _this.danMuSocket.disconnect();
                    } catch (e) {}
                    _this.danMuSocket = null;
                }
                _this.danMuSocketToken = null;
                _this.danMuDoc = null;
                // 3) 移除弹幕相关 DOM
                $("#pushWebAnonymous").remove();
                $("#pushWebDanIcon").remove();
                $("#pushWebDanMuHideStyle").remove();
                $("#pushWebDanMuAreaStyle").remove();
                $("#pushWebDanMuArea").remove();
                $(".barrage").remove();
                // 4) 清空弹幕去重缓存与队列
                _this.settings.danMuSeenIds = null;
                _this.settings.danMuSeenCount = 0;
                _this.settings.danMuPaused = false;
                _this.settings.danMuQueue = null;
                _this.settings.danMuSendOpened = false;
                _this.settings.danMuSetting.selector = "body";
                // 5) 清理 danmu-float.js 创建的浮窗
                var dmFloatWrap = document.querySelector(".dm-float-wrap");
                if (dmFloatWrap) {
                    dmFloatWrap.remove();
                }
                var dmSendBox = document.getElementById("dm-send-box");
                if (dmSendBox) {
                    dmSendBox.remove();
                }
                // 6) 复位单例标志, 允许重新 init
                _this._initedAppName = null;
                _this._initGen = 0;
            }
        };
        return WebsitePusher;
    })();
} catch (err) {
    console && console.log(err);
}
