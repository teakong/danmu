var	KF = function(){};
if("undefined" != typeof(showdown)) {
    var converter = new showdown.Converter({"tables":true,
        "omitExtraWLInCodeBlocks":true,
        "noHeaderId":true,
        "prefixHeaderId":true,
        "rawPrefixHeaderId":true,
        "ghCompatibleHeaderId":true,
        "rawHeaderId":true,
        "headerLevelStart":true,
        "parseImgDimensions":true,
        "simplifiedAutoLink":true,
        "excludeTrailingPunctuationFromURLs":true,
        "literalMidWordUnderscores":true,
        "literalMidWordAsterisks":true,
        "strikethrough":true,
        "tablesHeaderId":true,
        "ghCodeBlocks":true,
        "tasklists":true,
        "smoothLivePreview":true,
        "smartIndentationFix":true,
        "disableForced4SpacesIndentedSublists":true,
        "simpleLineBreaks":true,
        "requireSpaceBeforeHeadingText":true,
        "ghMentions":true,
        "encodeEmails":true,
        "openLinksInNewWindow":true,
        "backslashEscapesHTMLTags":true,
        "emoji":true,
        "underline":true,
        "completeHTMLDocument":true,
        "metadata":true,
        "splitAdjacentBlockquotes":true});
}
KF.prototype = {
    settings: {},
    init: function(config){
        var settings = {
            mobile: false,
            uid: 0,
            url: "",
            token: "",
            channelName: "一封传话",
            name: "匿名",
            group: 0,
            avatar: ""
        };
        var base = this.extend(settings, config || {});
        this.settings = base;
        if(0 == base.uid || "" == base.url || "" == base.name || 0 == base.group || "" == base.avatar){
            alert("param missing");
            return false;
        }
        var url = base.url + "?group=" + base.group + "&token=" + base.token + "&createTime=" + base.createTime + "&channelCode=" + base.channelCode + "&shareFlag=" + base.shareFlag + "&channelName=" + base.channelName + "&uid=" + base.uid + "&name=" + base.name + "&avatar=" + encodeURIComponent(base.avatar);
        if(this.isMobile() || base.mobile){
            window.location.href = url;
        }else{
            this.openWindow(url, base.channelName, base.uid);
        }
    },
    extend: function(destination, source){
        for (var property in source)
            destination[property] = source[property];
        return destination;
    },
    openWindow: function(url, title, uid){
        var currentIndex;
        if("undefined" != typeof(layer)) {
            layer.open({
                type: 2,
                id: uid,
                title: title,
                shade: 0,
                area: ["640px", "540px"],
                content: url,
                success: function(layero, index) {
                    currentIndex = index;
                    // 在 success 回调中获取最大化按钮的 a 标签
                    var $maximizeLink = layero.find('.layui-layer-ico.layui-layer-max');
                    // 修改 a 标签的 href 属性为 iframe 地址
                    $maximizeLink.attr('href', url);
                    $maximizeLink.attr('target', '_blank');

                    var $minLink = layero.find('.layui-layer-min');
                    $minLink.attr('target', '_self');
                    var $closeLink = layero.find('.layui-layer-ico.layui-layer-close');
                    $closeLink.attr('target', '_self');
                },
                maxmin : true,
                min: function(layero) {
                    $(".layui-layer-title").css("font-size", "12px");
                    // 如果最小化成功后, 将a标签恢复
                    setTimeout(function () {
                        $(".layui-layer-maxmin").removeAttr('target');
                        $(".layui-layer-maxmin").attr('href', 'javascript:;');
                        var $maximizeLink = layero.find('.layui-layer-ico.layui-layer-max');
                        $(".layui-layer-maxmin").click(function(){
                            var counter = $maximizeLink.attr("counter") ? $maximizeLink.attr("counter") : 0;
                            if(counter >= 1) {
                                return true;
                            }
                            $maximizeLink.attr("counter", counter + 1);
                            return false
                        });
                    }, 100);
                },
                full: function(layero) {
                    layer.restore(currentIndex);
                    $(".layui-layer-title").css("font-size", "16px");
                },
                restore: function(layero) {
                    // 在 success 回调中获取最大化按钮的 a 标签
                    var $maximizeLink = layero.find('.layui-layer-ico.layui-layer-max');
                    // 修改 a 标签的 href 属性为 iframe 地址
                    $maximizeLink.attr('href', url);
                    $maximizeLink.attr('target', '_blank');
                    $(".layui-layer-title").css("font-size", "16px");
                    $maximizeLink.attr("counter", 0);
                }
            });
        }
    },
    isMobile: function(){
        if( navigator.userAgent.match(/Android/i) || navigator.userAgent.match(/webOS/i) || navigator.userAgent.match(/iPhone/i) || navigator.userAgent.match(/iPod/i) || navigator.userAgent.match(/BlackBerry/i) || navigator.userAgent.match(/Windows Phone/i)){
            return true;
        } else {
            return false;
        }
    }
};

function showNewMessage(message) {
    var content = message.content;
    try {
        var chatJson = JSON.parse(content);
        if(chatJson["fromId"] && chatJson["toId"]) {
            if(chatJson["fromId"] != config.uid) {
                $('#content').html(chatJson["fromName"]+'：'+chatJson.content);
                $('.notification.sticky').notify();
            }
            return;
        }
    }catch (e) {
    }
    $('#content').html('收到新消息：'+message.content);
    $('.notification.sticky').notify();
}

function compileMarkDown(str){
    var html = converter.makeHtml(str);
    return html.replace('<!DOCTYPE HTML>\n' +
        '<html>\n' +
        '<head>\n' +
        '<meta charset="utf-8">\n' +
        '</head>\n' +
        '<body>', '').replace('</body>\n' +
        '</html>', '')
        .replace('href=\'<a href="', 'href="')
        .replace('target="_blank"&gt;', 'target="_blank">')
        .replace('<a" rel="noopener noreferrer">', '<a rel="noopener noreferrer">')
        .replace('<a</a>', '<a')
        .replace(/<br \/>/g, '<br>')
        .replace(/<br\/>/g, '<br>')
        .replace(/\\r\\n/g, '<br>')
        .replace(/\\n/g, '<br>')
        .replace(/\n/g, '<br>')
        .replace(/<br><br>+/g, '<br>')
        .replace(/^(<br>)+|(<br>)+$/g, '');
}

// 转义聊天内容中的特殊字符
function replaceContent(content) {
    // 判断是否含有a标签
    var html = compileMarkDown(content);
    var pattern = /(<\/?a.*?>)|(<\/?span.*?>)/;
    if(pattern.test(html)) {
        return html;
    }

    // 支持的html标签
    var html = function (end) {
        return new RegExp('\\n*\\[' + (end || '') + '(pre|div|span|p|table|thead|th|tbody|tr|td|ul|li|ol|li|dl|dt|dd|h2|h3|h4|h5)([\\s\\S]*?)\\]\\n*', 'g');
    };
    content = (content || '').replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;') // XSS
        .replace(/@(\S+)(\s+?|$)/g, '@<a href="javascript:;">$1</a>$2') // 转义@

        .replace(/face\[([^\s\[\]]+?)\]/g, function (face) {  // 转义表情
            var alt = face.replace(/^face/g, '');
            var faces = getFaces();
            return '<img alt="' + alt + '" title="' + alt + '" src="' + faces[alt] + '">';
        })
        .replace(/img\[([^\s]+?)\]/g, function (img) {  // 转义图片
            if(img.indexOf("?") == -1) {
                return '<img class="layui-photos" src="' + img.replace(/(^img\[)|(\]$)/g, '') + '?from_id='+config.uid+'&token='+config.token+'" width="100px" height="100px">';
            }else{
                return '<img class="layui-photos" src="' + img.replace(/(^img\[)|(\]$)/g, '') + '&from_id='+config.uid+'&token='+config.token+'" width="100px" height="100px">';
            }
        })
        .replace(/file\([\s\S]+?\)\[[\s\S]*?\]/g, function (str) { // 转义文件
            var href = (str.match(/file\(([\s\S]+?)\)\[/) || [])[1];
            var text = (str.match(/\)\[([\s\S]*?)\]/) || [])[1];
            if (!href) return str;
            if(href.indexOf("?") == -1) {
                return '<a class="layui-file" href="' + href + '?from_id='+config.uid+'&token='+config.token+'" download target="_blank"><i class="layui-icon">&#xe61e;</i><cite>' + (text || href) + '</cite></a>';
            }else{
                return '<a class="layui-file" href="' + href + '&from_id='+config.uid+'&token='+config.token+'" download target="_blank"><i class="layui-icon">&#xe61e;</i><cite>' + (text || href) + '</cite></a>';
            }
        })
        .replace(/a\([\s\S]+?\)\[[\s\S]*?\]/g, function (str) { // 转义链接
            var href = (str.match(/a\(([\s\S]+?)\)\[/) || [])[1];
            var text = (str.match(/\)\[([\s\S]*?)\]/) || [])[1];
            if (!href) return str;
            return '<a href="' + href + '" target="_blank">' + (text || href) + '</a>';
        }).replace(html(), '\<$1 $2\>').replace(html('/'), '\</$1\>') // 转移HTML代码
        .replace(/\\r\\n/g, '<br>')
        .replace(/\\n/g, '<br>')
        .replace(/\n/g, '<br>'); // 转义换行
    return content;
};
function getFaces() {
    var alt = getFacesIcon();
    var arr = {};
    for(var i=0; i<alt.length; i++) {
        arr[alt[i]] = '/static/customer/images/face/' + i + '.gif';
    }
    return arr;
}
// 表情对应数组
function getFacesIcon() {
    return ["[微笑]", "[嘻嘻]", "[哈哈]", "[可爱]", "[可怜]", "[挖鼻]", "[吃惊]", "[害羞]", "[挤眼]", "[闭嘴]", "[鄙视]",
        "[爱你]", "[泪]", "[偷笑]", "[亲亲]", "[生病]", "[太开心]", "[白眼]", "[右哼哼]", "[左哼哼]", "[嘘]", "[衰]",
        "[委屈]", "[吐]", "[哈欠]", "[抱抱]", "[怒]", "[疑问]", "[馋嘴]", "[拜拜]", "[思考]", "[汗]", "[困]", "[睡]",
        "[钱]", "[失望]", "[酷]", "[色]", "[哼]", "[鼓掌]", "[晕]", "[悲伤]", "[抓狂]", "[黑线]", "[阴险]", "[怒骂]",
        "[互粉]", "[心]", "[伤心]", "[猪头]", "[熊猫]", "[兔子]", "[ok]", "[耶]", "[good]", "[NO]", "[赞]", "[来]",
        "[弱]", "[草泥马]", "[神马]", "[囧]", "[浮云]", "[给力]", "[围观]", "[威武]"]
}