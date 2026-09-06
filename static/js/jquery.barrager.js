/*!
 *@name     jquery.barrager.js
 *@version  1.1
 *@author   yaseng@uauc.net
 *@url      https://github.com/yaseng/jquery.barrager.js
 */
(function ($) {
	$.fn.barrager = function (barrage) {
		barrage = $.extend(
			{
				like: 1,
				close: 0,
				closeText: "关闭",
				num: 0,
				bottom: 0,
				max: 10,
				speed: 8,
				opacity: 0,
				size: 16,
				color: "#fff",
				old_ie_color: "#000000",
				// 弹幕被关闭/点赞/取消点赞时回调, 参数: function(barrage, action), action='close'|'like'|'unlike'
				onAction: null,
			},
			barrage || {},
		);

		// num 归一化为整数
		barrage.num = parseInt(barrage.num, 10) || 0;

		var time = new Date().getTime();
		var barrager_id = "barrage_" + time;
		var id = "#" + barrager_id;
		var div_barrager = $(
			"<div class='barrage' id='" + barrager_id + "'></div>",
		).appendTo($(this));
		var window_height = $(window).height() - 100;
		var this_height =
			window_height > this.height() ? this.height() : window_height;
		var window_width = $(window).width() + 500;
		var this_width = window_width > this.width() ? this.width() : window_width;
		var bottom =
			barrage.bottom == 0
				? Math.floor(Math.random() * this_height + 40)
				: barrage.bottom;
		var size = barrage.size < 8 || barrage.size > 33 ? 16 : barrage.size;
		// 透明度映射 (控制面板滑块 0~100, rgba alpha 取值 0~1, 直接除以100):
		//   opacity < 0   → 夹紧为 0   (背景完全透明, 只留彩色文字/按钮)
		//   opacity > 100 → 夹紧为 100 (背景最黑, alpha=1)
		//   alpha = opacity / 100, 例: 0→0(透明) | 50→0.5 | 100→1(不透明)
		// 不再改整个 .barrage 的 opacity(会把文字/按钮也一起半透明),
		// 改为只改 .barrage_box 背景 rgba 的 alpha 通道, 视觉上只有背景黑度变化, 文本/图标始终清晰
		var opacityClamped = Math.max(
			0,
			Math.min(100, Number(barrage.opacity) || 0),
		);
		var bgAlpha = (opacityClamped / 100).toFixed(2);
		div_barrager.css("bottom", bottom + "px");
		var div_barrager_box = $("<div class='barrage_box cl'></div>")
			.css("background-color", "rgba(0,0,0," + bgAlpha + ")")
			.data("origBgAlpha", bgAlpha) // 保存原始背景alpha, 用于hover离开时还原
			.appendTo(div_barrager);
		// hover 背景加深方便点击close/like: 取 max(当前alpha, 0.5), 离开后恢复各自按opacity算出来的alpha
		div_barrager_box.on({
			mouseenter: function () {
				var orig = parseFloat($(this).data("origBgAlpha")) || 0;
				$(this).css(
					"background-color",
					"rgba(0,0,0," + Math.max(orig, 0.5) + ")",
				);
			},
			mouseleave: function () {
				var orig = $(this).data("origBgAlpha");
				$(this).css(
					"background-color",
					"rgba(0,0,0," + (typeof orig === "string" ? orig : "0.4") + ")",
				);
			},
		});
		if (barrage.img) {
			div_barrager_box.append("<a class='portrait z' href='javascript:;'></a>");
			var img = $("<img src='' >").appendTo(id + " .barrage_box .portrait");
			img.attr("src", barrage.img);
		}
		div_barrager_box.append(" <div class='z p'></div>");
		// 4种情况: close=1优先展示close(忽略like); close=0且like=1展示like; 均0不展示
		// like(25x25❤圆形按钮) 与 num(独立浮动span) 为同级元素, 避免图标与数字重叠
		if (barrage.close) {
			div_barrager_box.append(
				" <div class='close z' title='" +
				(barrage.closeText || "") +
				"'></div>",
			);
		} else if (barrage.like) {
			var hasNum = barrage.num > 0;
			var $like = $(
				"<div class='like z" + (hasNum ? " has-num" : "") + "'></div>",
			);
			div_barrager_box.append($like);
			if (hasNum) {
				var $num = $("<span class='num'>" + barrage.num + "</span>");
				div_barrager_box.append($num);
			}
		}

		var content = $(
			"<a title='' style='font-size: " +
			size +
			"px' href='' target='_blank'></a>",
		).appendTo(id + " .barrage_box .p");
		content
			.attr({
				href: barrage.href,
				id: barrage.id,
			})
			.empty()
			.append(barrage.info);
		// 颜色同时设置到 .p 容器上: 省略号(text-overflow)由 .p 容器绘制, 只给内层a设置颜色会导致省略号颜色不一致
		if (
			navigator.userAgent.indexOf("MSIE 6.0") > 0 ||
			navigator.userAgent.indexOf("MSIE 7.0") > 0 ||
			navigator.userAgent.indexOf("MSIE 8.0") > 0
		) {
			content.parent(".p").css("color", barrage.old_ie_color);
			content.css("color", barrage.old_ie_color);
		} else {
			content.parent(".p").css("color", barrage.color);
			content.css("color", barrage.color);
		}

		var i = 0;

		// 动态计算真实宽度, 覆盖CSS中固定的800px, 避免短文本时剩余空白遮挡页面
		// 步骤1: 先测内容真实宽度 —— clone完整.barrage容器到body下离屏测量
		//   (必须保留.barrage包装层: .barrage .z{float:left!important} 是级联选择器,
		//    若只clone .barrage_box, 子元素不浮动会纵向堆叠, 测出宽度严重偏小)
		//   (clone到body下测量: 与挂载容器尺寸/可见性解耦, 避免selector容器为0尺寸时测出极小值)
		var $measureWrap = div_barrager
			.clone()
			.attr("id", "")
			.css({
				position: "absolute",
				left: "-9999px",
				top: "0px",
				visibility: "hidden",
			});
		$("body").append($measureWrap);
		var realWidth = $measureWrap.find(".barrage_box").outerWidth(true);
		// 旧CSS兼容(display:none不占布局会漏算): 按 25px圆钮 + 20px左边距 补上
		$measureWrap.find(".close,.like,.num").each(function () {
			if (this.offsetWidth === 0) {
				realWidth += 45;
			}
		});
		$measureWrap.remove();
		// 步骤2: 在真实宽度之和基础上再预留, 保证后续交互不换行不跳动
		//   like场景统一预留40px(约4位数字9999): num=0时DOM无.num, 点击后从0涨到9999都够用,
		//   期间不改外层宽度, 既不会视觉跳动也不会float换行
		if (!barrage.close && barrage.like) {
			realWidth += 40;
		}
		//   buffer: 抵消字体/emoji渲染的亚像素误差
		realWidth += 6;
		if (realWidth > 0) {
			div_barrager.css("width", realWidth + "px");
		}

		div_barrager.css("margin-right", 0);

		$(id).animate({ right: this_width }, barrage.speed * 1000, function () {
			$(id).remove();
		});

		div_barrager_box.mouseover(function () {
			$(id).stop(true);
		});

		div_barrager_box.mouseout(function () {
			$(id).animate({ right: this_width }, barrage.speed * 1000, function () {
				$(id).remove();
			});
		});
		if (barrage.close) {
			$(id + ".barrage .barrage_box .close").click(function () {
				$(id).remove();
				// 通知调用者: 当前弹幕被关闭
				if ($.isFunction(barrage.onAction)) {
					barrage.onAction.call(div_barrager[0], barrage, "close");
				}
			});
		} else if (barrage.like) {
			var toggleLike = function () {
				var $like = $(id + ".barrage .barrage_box .like");
				var $num = $(id + ".barrage .barrage_box .num");
				var liked = $like.hasClass("liked");
				if (liked) {
					// 取消点赞: 移除 liked, num-1
					$like.removeClass("liked");
					barrage.num = Math.max(0, barrage.num - 1);
				} else {
					// 点赞: 加 liked, num+1
					$like.addClass("liked");
					barrage.num += 1;
				}
				// 同步 num 元素状态
				if (barrage.num > 0) {
					// 始终显示❤(has-num) + 数字
					$like.addClass("has-num");
					if ($num.length) {
						$num.text(barrage.num);
					} else {
						$num = $(
							"<span class='num'>" + barrage.num + "</span>",
						).insertAfter($like);
					}
					if (!liked) {
						$num.addClass("liked");
					} else {
						$num.removeClass("liked");
					}
				} else {
					// num 归零: 移除数字元素, has-num 也去掉(恢复默认hover显隐)
					$num.remove();
					$like.removeClass("has-num");
				}
				// (初始化时已为 num 预留 40px 空位, 0~9999 赞范围内都够用, 不再动态改外层宽度避免视觉跳动)
				// 回调
				if ($.isFunction(barrage.onAction)) {
					barrage.onAction.call(
						div_barrager[0],
						barrage,
						liked ? "unlike" : "like",
					);
				}
			};
			// ❤图标 和 数字 均为点击触发区
			$(id + ".barrage .barrage_box .like").click(toggleLike);
			$(id + ".barrage .barrage_box .num").click(toggleLike);
		}
	};

	$.fn.barrager.removeAll = function () {
		$(".barrage").remove();
	};
})(jQuery);
