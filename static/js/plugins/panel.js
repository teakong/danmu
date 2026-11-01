/**
 * panel.js — 右上角面板插件（pusher.js 的 plugins/ 目录内的官方插件）
 *
 * 接入（组件不默认加载本插件, 需要面板时才把 panel 写进 plugins）：
 *   WebsitePusher.init({ plugins: "panel" })
 *   或 <script src="//ws.phprm.com/static/customer/js/danmu.js?plugins=panel"></script>
 *
 * 接管的内容（组件里已不再内置这些 UI）：
 *   1) 面板外壳: 固定右上角 + 标题栏拖动/吸边/关闭(下面挂到 $.fn.bg_move 的实现, 已从组件搬来)
 *   2) 推送窗口(#pushWebAnonymous iframe): 通道码输入/打开推送通道/增加更多通道/登录账户/获取通道码
 *   3) 弹幕设置(#danmuConfig 表单): 不透明度/大小/速度/关闭/高度/AI弹幕 + 保存/重置
 *   4) 登录窗口(#pushWeblogin iframe): 登录表单/验证码/记住密码/我的消息提醒列表/匿名推送/退出登录
 *   5) 面板独占的业务代码(已从组件搬来): 登录态查询/登录提交/验证码签发刷新/退出登录/我的提醒列表,
 *      弹幕设置表单的提示/范围校验/配置回填与切页, "增加更多通道", 面板 iframe 通用样式
 *   通道认领、配置持久化、弹幕启动等跨场景逻辑仍留在组件里, 通过公开的 WebsitePusher 方法调用。
 *
 * 可选 settings：
 *   panelWidth   面板宽度 px, 默认 460
 *
 * 说明：
 *   - 组件 init 时调用 initPusherWindow -> WebsitePusher.panel.openPusherWindow();
 *     面板里点"登录账户"-> 本插件 unlogin() -> openLoginWindow(); 登录窗口点"匿名推送"
 *     -> WebsitePusher.initPusherWindow(false) -> panel.openPusherWindow()
 *     组合通道(pushType=10) -> 组件 openPanel("addChannelInput") -> panel.addChannelInput()
 *   - 不加载本插件时组件不创建任何面板, 通道认领与弹幕走无 UI 的 WebsitePusher.initChannel()
 *   - 严格 ES5（依赖组件已加载的 jQuery）
 */
(function () {
    if (typeof WebsitePusher === "undefined" || !WebsitePusher.registerPlugin) {
        return;
    }

    var NAME = "panel";

    function log(msg) {
        if (typeof console != "undefined" && console.log) {
            console.log(msg);
        }
    }

    function settingsOf() {
        return WebsitePusher.settings;
    }

    // 面板外壳的拖动/吸边用的是下面挂到 jQuery.fn.bg_move 的实现, 没有 jQuery 时本插件不生效
    if (typeof jQuery == "undefined") {
        return;
    }

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
                // 未拖动过（初始/面板被隐藏时 inlineLeft 为空）或被吸边（left 在屏幕外）→ 恢复到右侧默认位置
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

    /**
     * 面板外壳: 固定右上角, 标题栏可拖动/吸边, 右上角关闭
     * @param {String} panelId 面板 id
     * @param {String} contentHtml 面板内容(标题栏由本方法生成)
     * @param {Function} [onClosed] 关闭按钮回调
     */
    function buildBox(panelId, contentHtml, onClosed) {
        var s = settingsOf();
        var div = document.createElement("div");
        div.id = panelId;
        div.style.cssText =
            "position:fixed;_position:absolute;right:12px;top:8px;_top:expression(eval(documentElement.scrollTop+8));width:" +
            (s.panelWidth || 460) +
            "px;z-index:2147483647;border-width:0px;user-select:none;";
        var cssSite = s.cssSite;
        div.innerHTML =
            '<div class="topbjcl" style="user-select:none;cursor:move;height:33px;background-image:url(' +
            cssSite +
            'images/1.gif);background-repeat:repeat-x;border:1px solid #d8d8d8;border-bottom:none">' +
            '<div style="padding-top:5px;padding-left:20px;float:left;color:#555;font-family:Arial,Helvetica,sans-serif;font-size:12px;">' +
            '<span class="logo-text">' +
            s.siteName +
            "</span>" +
            "</div>" +
            '<div style="cursor:pointer;float:right;padding-right:10px;padding-top:3px">' +
            '<span title="关闭"><img class="pusher-close-btn" src="' +
            cssSite +
            'images/4.gif" /></span>' +
            "</div>" +
            "</div>" +
            '<div style="width:470px;padding:0px;" class="ydnwc-dialog">' +
            contentHtml +
            "</div>";
        document.body.appendChild(div);
        $("#" + div.id).bg_move({
            move: ".topbjcl",
            closed: ".pusher-close-btn",
            size: 6,
            onClosed: onClosed,
        });
        return div;
    }

    // 推送窗口 iframe 内容: 通道码 / 打开推送通道 / 增加更多通道 / 登录账户 / 获取通道码 / 弹幕设置
    function pusherWindowHtml() {
        var s = settingsOf();
        var ds = s.danMuSetting;
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
            '<div class="footer-spacer" style=" text-align:center; padding-top:153px; height:38px;"><img src="' +
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
    }

    // 登录窗口 iframe 内容: 登录表单 / 我的消息提醒列表 / 匿名推送 / 退出登录
    function loginWindowHtml() {
        var s = settingsOf();
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
            '<div class="login-captcha"><input id="randomStr" type="hidden" value=""/>' +
            '<span><img class="random-code" alt="验证码"/></span></div>' +
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
    }

    /**
     * 打开推送窗口(右上角面板)
     * 注意: 形参名不能叫 checkLoginStatus, 否则会遮蔽下面的同名函数, 调用时变成 "true(doc, cb)" 抛 TypeError,
     * 导致"登录账户"文案写不进去(面板上没有登录入口)
     * @param {Boolean} checkLoginState 是否自动查询登录态(用户点"匿名推送"时传 false, 不自动跳登录窗口)
     * @param {String} [channelCode] 本次 init 传入的通道码
     */
    function openPusherWindow(checkLoginState, channelCode) {
        var api = WebsitePusher;
        var s = settingsOf();
        s.channelCode = channelCode || "";
        // 打开推送窗口前先关掉登录窗口(旧版由组件 initPusherWindow 负责清理)
        closeLogin();
        styleIframes();
        buildBox(
            "pushWebAnonymous",
            '<div id="pusherNewWindow" style="width:470px;padding:0px;" class="ydnwc-dialog"><div id="pusherViewLogin" style="width:470px;height:490px;"></div></div>',
            function () {
                api.closePusher();
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
            var html = pusherWindowHtml();
            doc.write(html);
            doc.close();

            $doc.find("#loading").text("正在加载中...");
            $doc.find(".main").fadeIn(100, function () {
                $doc.find("#loading").hide();
                $doc.find(".main-pusher").fadeIn(100);
                // checkLoginState: init()传true检查登录态; 用户点"匿名推送"传false不自动跳转
                // 弹幕模式下推送窗口不自动检查登录态(避免弹幕初始化时跳转登录窗口),
                // 但 unlogin 打开的登录窗口仍需检查
                if (checkLoginState && s.danMu != 1) {
                    checkLoginStatus(doc, function (resp) {
                        var data = resp.data;
                        if (data && data["userInfo"]) {
                            $doc
                                .find(".loginButton")
                                .text("用户" + data["nickname"] + "已登录");
                            loginSuccess($doc.find(".main-login"));
                            unlogin($doc.find(".loginButton").get(0));
                        } else {
                            logout($doc.find(".main-pusher").get(0));
                        }
                    });
                } else {
                    $doc.find(".loginButton").text("登录账户");
                }
            });

            $doc.find(".loginButton").click(function () {
                unlogin(this);
            });
            // 弹幕设置保存
            $doc.find(".saveButton").click(function () {
                if (api.danMuTimer) {
                    window.clearTimeout(api.danMuTimer);
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
                api.setDanMuStorage(JSON.stringify(json));
                api.updateCfgCache(json);
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
                        if (rangeFail.apply(null, [doc].concat(ranges[r])))
                            return;
                    }
                } else {
                    for (var r2 = 0; r2 < 3; r2++) {
                        if (rangeFail.apply(null, [doc].concat(ranges[r2])))
                            return;
                    }
                }
                if (
                    airadio == 1 &&
                    rangeFail(
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
                showDanMuMsg(doc, "配置已生效");
            });
            // 弹幕设置重置
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
                showDanMuMsg(doc, "配置已重置");
                // 清理上一轮定时器并重新查询AI弹幕
                if (api.danMuTimer) {
                    window.clearTimeout(api.danMuTimer);
                }
                s.danMuSetting.aiDanMu = 0;
                api.removeDanMuStorage();
                api.updateCfgCache({});
            });
            $doc.find(".channelCode").keyup(function () {
                $(this)
                    .parents(".channel-input")
                    .find("div[id='channelMsg']")
                    .text("");
            });
            $doc.find(".add-button").click(function () {
                addChannelInput(this);
            });
            $doc.find(".pusher-button").click(function () {
                api.openPusherDialog(this);
            });
            // 从url参数中读取是否传
            if (!s.channelCode) {
                // 如果当前网址开启了弹幕
                var headers = api.getSignHeaders();
                api.ajaxGet(
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
                            api.openPusherDialog($doc.find(".channelCode").get(0));
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
            api.openPusherDialog($doc.find(".channelCode").get(0));
        } catch (err) {
            console && console.log(err);
        }
    }

    // 打开登录窗口(面板里点"登录账户"进入)
    function openLoginWindow(button) {
        var api = WebsitePusher;
        var s = settingsOf();
        styleIframes();
        buildBox(
            "pushWeblogin",
            '<div style="width:470px;padding:0px;" id="pushWebloginContent" class="ydnwc-dialog"><div id="viewLogin" style="width:470px;height:490px;"></div></div>',
            function () {
                closeLogin();
            },
        );
        var loginHtml =
            "<iframe frameborder='0' src=\"javascript:void((function(){var d=document;d.open();document.domain='" +
            document.domain +
            "';d.write('');d.close()})())\" scrolling='no' width='470' height='490' id='loginIframe' allowtransparency></iframe>";
        $("#viewLogin").html(loginHtml);
        var loginFrame = $("#loginIframe")[0];
        try {
            var doc = loginFrame.contentWindow.document;
            var $doc = $(doc);
            doc.open();
            var html = loginWindowHtml();
            doc.write(html);
            doc.close();
            // 登录框先渲染, 验证码标识异步向服务端申请后再挂图片 src
            refreshRandomStr($doc.find(".login-captcha"));

            $doc.find("#loading").text("正在加载中...");
            $doc.find(".main").fadeIn(100, function () {
                $doc.find("#loading").hide();
                $(loginFrame.contentWindow).load(function () {
                    $doc.find(".main-login").fadeIn(100);
                });
            });

            $doc.find("#logoutButton").click(function () {
                logout(this);
            });
            $doc.find("#anonymousButton").click(function () {
                api.initPusherWindow(false);
            });
            $doc.find(".pusher-close-btn").click(function () {
                closeLogin(this);
            });
            $doc.find("#btnLogin").click(function () {
                startLogin(this);
            });
            $doc.find(".login-captcha").click(function () {
                refreshRandomStr(this);
            });
            checkLoginStatus(doc, function (resp) {
                var data = resp.data;
                if (data && data["userInfo"]) {
                    $doc
                        .find(".loginButton")
                        .text("用户" + data["nickname"] + "已登录");
                    loginSuccess($doc.find(".main-login"));
                } else {
                    logout($doc.find("#logoutButton").get(0));
                }
            });
        } catch (err) {
            console && console.log(err);
        }
    }

    // 右下角弹幕图标点击: 面板吸边/恢复, 或显示/隐藏
    function togglePanel() {
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
                if (parsed < 0 || parsed > $(window).width() - $panel.outerWidth()) {
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
    }

    /* ===== 1. 面板专用的业务代码(登录/提醒列表/弹幕设置表单/通道输入, 已从 pusher.js 搬来) ===== */

    // iframe 通用样式: 面板里的 iframe 靠它去掉白边并限制最大高度(原组件 init 里的 styleIframe)
    var iframeStyled = false;
    function styleIframes() {
        if (iframeStyled) {
            return;
        }
        iframeStyled = true;
        if (document.all) {
            var sheet = document.createStyleSheet();
            sheet.addRule("iframe", "max-height: 2000px;margin-top:-3px");
        } else {
            var style = document.createElement("style");
            style.type = "text/css";
            style.innerHTML = "iframe{ max-height: 2000px;margin-top:-3px }";
            document.getElementsByTagName("HEAD").item(0).appendChild(style);
        }
    }

    // 关闭登录窗口(面板 DOM; 仅本插件使用)
    function closeLogin() {
        $("#pushWeblogin").remove();
    }

    // 面板里点"登录账户": 关推送窗口, 开登录窗口
    function unlogin(button) {
        var api = WebsitePusher;
        api.closePusher();
        closeLogin();
        return openLoginWindow(button);
    }

    function checkLoginStatus(doc, callback) {
        var api = WebsitePusher;
        var $doc = $(doc);
        $doc.find(".loginButton").text("登录账户");
        var appKey = api.cookieGet("appKey");
        if (!appKey) {
            return;
        }
        var headers = api.getSignHeaders();
        api.ajaxGet(
            api.settings.apiUrl,
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
    }

    function buildTableRow(item) {
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
    }

    function showDanMuMsg(doc, text) {
        $(doc)
            .find("#danmuMsg")
            .text(text)
            .animate({ opacity: 0 }, 4000, function () {
                $(this).text("").css("opacity", 1);
            });
    }

    function rangeFail(doc, val, min, max, defVal, rangeText, inputName) {
        if (val < min || val > max) {
            showDanMuMsg(doc, rangeText);
            $(doc)
                .find("#danmuConfig form input[name=" + inputName + "]")
                .val(defVal);
            return true;
        }
        return false;
    }

    // 通道行变多时重排底部: 压缩 footer 上方的留白, 并按内容高度撑高 .main,
    // 否则 footer(登录账户/获取通道码) 会被 490px 高的 iframe 裁掉 —— 多通道下这是唯一的登录入口
    function relayoutPusherBottom(input) {
        var doc = input.length ? input[0].ownerDocument : null;
        if (!doc) {
            return;
        }
        var win = doc.defaultView || doc.parentWindow;
        var viewH = win && win.innerHeight ? win.innerHeight : 490;
        var $main = input.closest(".main");
        var $spacer = $main.find(".footer-spacer");
        var $footer = $main.find(".footer");
        var $formButton = input.find(".form-button");
        if ($main.length === 0 || $spacer.length === 0 || $footer.length === 0 || $formButton.length === 0) {
            return;
        }
        var mainTop = $main[0].getBoundingClientRect().top;
        var formBottom = $formButton[0].getBoundingClientRect().bottom - mainTop;
        var spacerH = $spacer.height();
        var footerH = $footer.outerHeight();
        // 目标: footer 贴在可视区底部上方 8px; 留白不足时压缩到 0(最大保持原留白 153px)
        var pad = viewH - 8 - footerH - formBottom - spacerH;
        if (pad > 153) {
            pad = 153;
        } else if (pad < 0) {
            pad = 0;
        }
        $spacer.css("padding-top", pad + "px");
        // .main 固定 470px 高, 行多时 footer 会落到灰底之外, 按内容高度撑高(不超过可视高度)
        var contentH = formBottom + spacerH + pad + footerH + 4;
        if (contentH < 470) {
            contentH = 470;
        } else if (contentH > viewH) {
            contentH = viewH;
        }
        $main.css("height", contentH + "px");
    }

    function addChannelInput(button, channelCode) {
        var api = WebsitePusher;
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
        $(html).insertBefore($(button).parent());
        input
            .find(".channel-group:last")
            .find(".pusher-button")
            .click(function () {
                api.openPusherDialog(this);
            });
        relayoutPusherBottom(input);
    }

    function startLogin(button) {
        var api = WebsitePusher;
        var mainLogin = $(button).parents(".main-login");
        if (!mainLogin.find("#randomStr").val()) {
            // randomStr 由服务端异步签发, 尚未到手时先不提交
            mainLogin.find("#verifyCode").focus();
            return;
        }
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
        usernameLogin(obj, function (resp) {
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
            api.storeUserInfo("appKey", data["appKey"], chkRemember);
            loginSuccess(mainLogin);
        });
    }

    function loginSuccess(mainLogin) {
        if (mainLogin.length == 0) {
            return;
        }
        var api = WebsitePusher;
        mainLogin.find("#divLogin").hide();
        mainLogin.find("#divTodo").show();
        mainLogin.find("#logoutButton").show();
        var appKey = api.getUserInfo("appKey");
        var headers = api.getSignHeaders();
        var params = {
            type: "getMyWebsitePluginRelByTag",
            appKey: appKey,
            pid: 0,
            _t: headers["apiTimestamp"],
            page: 1,
            limit: 5
        };
        loadPage(params, headers, function (resp) {
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
                html += buildTableRow(r[i]);
            }
            if (data["totalPage"] > 1) {
                html += pagerHead + "没有更多了</span>\n</div>";
            } else if (data["totalPage"] == 0) {
                html +=
                    pagerHead +
                    '还没创建过任何提醒，<a href="' +
                    api.settings.apiUrl.replace("/app/api/getDataInfo", "") +
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
                    url: api.settings.pcUrl,
                    channelName: $btn.data("title"),
                    uid: $btn.data("uid"),
                    createTime: $btn.data("time"),
                    name: $btn.data("name"),
                    avatar: $btn.data("avatar"),
                    group: $btn.data("group"),
                    channelCode: $btn.data("code"),
                    token: $btn.data("token"),
                    shareFlag: $btn.data("share"),
                    wsUrl: api.channelWsUrl || api.settings.wsUrl
                    };
                api.initPusherKF(params);
            });

            mainLogin.find("#loadMore").click(function () {
                params.page = params.page + 1;
                loadPage(params, headers, function (resp) {
                    if (resp.code != 0) {
                        mainLogin.find("#todoMsg").text(resp.message);
                        return;
                    }
                    var data = resp["data"];
                    var r = data["records"];
                    var html = "";
                    for (var i = 0; i < r.length; i++) {
                        html += buildTableRow(r[i]);
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
    }

    function loadPage(params, headers, callback) {
        var api = WebsitePusher;
        api.ajaxGet(
            api.settings.apiUrl,
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
    }

    function usernameLogin(obj, callback) {
        var api = WebsitePusher;
        $.ajax({
            url: api.settings.authUrl + "/mobile/token/form",
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
                refreshRandomStr(obj.node);
                if (!resp.access_token) {
                    obj.node.find("#loginMsg").text(resp.message);
                    return;
                }
                var headers = api.getSignHeaders();
                api.ajaxGet(
                    api.settings.apiUrl,
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
    }

    /**
     * 验证码标识 randomStr 由服务端签发 (GET /draw/captcha/key),
     * 前端不再生成 randomStr, 否则 /draw/captcha/image 会因未签发而拒出图
     * @param {function(string)} callback 回调, 参数为签发值, 失败时为空字符串
     */
    function fetchCaptchaKey(callback) {
        var api = WebsitePusher;
        $.ajax({
            url: api.settings.authUrl + "/draw/captcha/key",
            type: "GET",
            dataType: "json",
            crossDomain: true,
            success: function (res) {
                callback(res && res.code == 0 && res.data ? res.data : "");
            },
            error: function () {
                callback("");
            },
        });
    }

    function refreshRandomStr(button) {
        var api = WebsitePusher;
        var captchaBox = $(button);
        fetchCaptchaKey(function (randomStr) {
            if (!randomStr) {
                // 签发失败保持原状, 用户可再次点击重试
                return;
            }
            captchaBox.find("#randomStr").val(randomStr);
            captchaBox
                .find(".random-code")
                .attr(
                    "src",
                    api.settings.authUrl +
                    "/draw/captcha/image?randomStr=" +
                    randomStr,
                );
        });
    }

    function logout(button) {
        var api = WebsitePusher;
        var mainLogin = $(button).parents(".main-login");
        api.storeUserInfo("appKey", "", -1);
        mainLogin.find("#logoutButton").hide();
        mainLogin.find("#divTodo").hide();
        mainLogin.find("#divLogin").show();
        mainLogin.find("#anonymousButton").show();
    }

    // 组件 initAiDanMu 的 UI 部分: 回填 #danmuConfig 表单并切到"弹幕设置"页
    function initDanMuConfigForm(doc, cfg, aiOn) {
        var $doc = $(doc);
        var mainPusher = $doc.find(".main-pusher");
        var mainConfig = $doc.find(".main-config");
        var $form = mainConfig.find("#danmuConfig form");
        // AI 分组只在开启轮询时显示(组件 checkAiDanMu 余额用完时会再收起)
        setAiDanMuGroup(doc, aiOn);
        var fields = [
            { key: "opacity", val: cfg.opacity, type: "val" },
            { key: "size", val: cfg.size, type: "val" },
            { key: "speed", val: cfg.speed, type: "val" },
            { key: "close", val: cfg.close != 0, type: "prop", attr: "checked" },
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
    }

    // AI 弹幕分组(AI 余额用完时组件会要求收起)
    function setAiDanMuGroup(doc, visible) {
        var $group = $(doc).find("#aiDanMuGroup");
        if (visible) {
            $group.show();
        } else {
            $group.hide();
        }
    }

    WebsitePusher.registerPlugin(NAME, function (settings) {
        if (!settings) {
            log("panel 插件：缺少 settings，跳过面板");
            return;
        }
        if (typeof jQuery == "undefined") {
            log("panel 插件：缺少 jQuery，无法创建面板");
            return;
        }
        // 组件 initPusherWindow / togglePusherPanel 通过 openPanel 转发到本插件
        WebsitePusher.panel = {
            openPusherWindow: openPusherWindow,
            openLoginWindow: openLoginWindow,
            toggle: togglePanel,
            // 组件 channelMemberSuccess(组合通道 pushType=10) 需要向面板追加通道码输入行
            addChannelInput: addChannelInput,
            // 组件 initAiDanMu / checkAiDanMu 的弹幕设置表单部分
            initDanMuConfigForm: initDanMuConfigForm,
            setAiDanMuGroup: setAiDanMuGroup,
        };
    });
})();
