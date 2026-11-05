/* =========================================================================
 * Markdown 转 HTML 离线工具 - 纯前端实现
 * -------------------------------------------------------------------------
 * 功能：
 *   1. 上传 1 个 markdown 或 html 文件（拖拽 / 点击选择均可）
 *   2. 输入 32 位 16 进制通道码，点击「添加通道码并下载」生成带通道码的
 *      离线 html；未输入通道码时生成不带通道码的离线 html
 *   3. 通道码 = 弹幕云服务（danmu.js）的推送通道标识，注入方式与
 *      danmu/simple.html 一致：向页面插入加载 danmu.js 的脚本，并在
 *      URL 上携带 channelCode 参数
 *   4. 上传已带通道码的 html 时自动识别并展示；重新输入通道码下载时
 *      替换原通道码；留空下载时移除通道码
 *
 * 本页面完全在浏览器本地运行，文件不上传服务器（Markdown 解析由
 * vendor/showdown.min.js 在本地完成）。
 * ========================================================================= */
(function () {
  'use strict';

  /* ==================== 常量 ==================== */
  var CHANNEL_RE = /^[0-9a-fA-F]{32}$/;          // 通道码：32 位 16 进制字符串
  var CHANNEL_CODE_RE = /channelCode=([0-9a-fA-F]{32})/i;  // 识别文档内已有通道码
  var CODE_PARAM_RE = /(channelCode=)[^&\s"'<>]*/gi;       // 定位待替换的通道码参数值
  var DANMU_JS = 'danmu.js';                     // 弹幕云服务脚本关键字
  var MAX_SIZE = 10 * 1024 * 1024;               // 单文件大小上限 10MB

  /* danmu.js 加载脚本模板（参考 danmu/simple.html）
   * appName 取导出页面的 document.title（运行时拼接）；
   * code 已通过 CHANNEL_RE 校验，可安全嵌入。 */
  function danmuLoader(code) {
    return '    (function() {\n' +
      '        var dm = document.createElement("script");\n' +
      '        dm.src = "https://ws.phprm.com/static/customer/js/danmu.js?appName=" + encodeURIComponent(document.title) + "&channelCode=' + code + '&hideDialog=1&hideIcon=1&danMu=0&plugins=stat,ad";\n' +
      '        var s = document.getElementsByTagName("script")[0];\n' +
      '        s.parentNode.insertBefore(dm, s);\n' +
      '    })();\n';
  }

  function danmuBlock(code) {
    return '<script>\n' + danmuLoader(code) + '</script>\n';
  }

  /* ==================== DOM 引用 ==================== */
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var fileList = document.getElementById('fileList');
  var uploadStatus = document.getElementById('uploadStatus');
  var btnReset = document.getElementById('btnReset');
  var ccInput = document.getElementById('ccInput');
  var ccShow = document.getElementById('ccShow');
  var ccStatus = document.getElementById('ccStatus');
  var btnChannel = document.getElementById('btnChannel');
  var adTip = document.getElementById('adTip');
  var adLink = document.getElementById('adLink');
  var step1 = document.getElementById('step1');
  var step2 = document.getElementById('step2');
  var step3 = document.getElementById('step3');

  /* ==================== 状态 ==================== */
  var file = { name: '', size: 0, kind: '', text: '', channel: '' };

  var converter = new showdown.Converter({
    tables: true,
    tasklists: true,
    strikethrough: true,
    ghCodeBlocks: true,
    simpleLineBreaks: false
  });

  /* ==================== 工具函数 ==================== */
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c];
    });
  }

  function baseName(name) {
    return String(name).replace(/\.[^.]+$/, '');
  }

  function extOf(name) {
    var m = String(name).toLowerCase().match(/\.([^.]+)$/);
    return m ? m[1] : '';
  }

  function isMarkdown(name) {
    return /^(md|markdown)$/.test(extOf(name));
  }

  function isHtml(name) {
    return /^(html|htm)$/.test(extOf(name));
  }

  function setStatus(el, msg, cls) {
    el.textContent = msg;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  function resetSteps() {
    step1.className = '';
    step2.className = '';
    step3.className = '';
  }

  /* ==================== 导出 HTML 模板 ==================== */
  var EXPORT_CSS =
    'body{max-width:820px;margin:40px auto;padding:0 20px;' +
    'font-family:-apple-system,Segoe UI,Microsoft YaHei,sans-serif;' +
    'line-height:1.7;color:#1f2a44;}' +
    'pre{background:#1f2a44;color:#e6ecff;padding:12px 14px;border-radius:8px;overflow:auto;}' +
    'code{background:#eef1f7;padding:2px 5px;border-radius:4px;}' +
    'pre code{background:transparent;color:inherit;padding:0;}' +
    'table{border-collapse:collapse;}th,td{border:1px solid #e5e9f2;padding:6px 10px;}' +
    'blockquote{margin:0;padding:6px 14px;border-left:3px solid #1a9e5a;color:#7a869a;background:#f4f7ff;}' +
    'img{max-width:100%;}';

  function buildHtmlFile(title, bodyHtml, code) {
    var out = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>' + escHtml(title) + '</title>\n' +
      '<style>' + EXPORT_CSS + '</style>\n</head>\n<body>\n' +
      bodyHtml + '\n';
    if (code) out += danmuBlock(code);
    out += '</body>\n</html>\n';
    return out;
  }

  /* ==================== 通道码处理（HTML 文件） ==================== */

  /* 从 html 文本中识别已嵌入的通道码（32 位 16 进制） */
  function extractChannelCode(html) {
    var m = String(html).match(CHANNEL_CODE_RE);
    return m ? m[1] : '';
  }

  /* 找出文档中与 danmu.js 相关的 <script> 节点（直接引用或包装加载均可） */
  function findDanmuScripts(doc) {
    var out = [];
    var nodes = doc.querySelectorAll('script');
    for (var i = 0; i < nodes.length; i++) {
      var src = nodes[i].getAttribute('src') || '';
      if (src.indexOf(DANMU_JS) !== -1 ||
          (nodes[i].textContent || '').indexOf(DANMU_JS) !== -1) {
        out.push(nodes[i]);
      }
    }
    return out;
  }

  /* 替换单个脚本节点内的通道码参数（src 或 JS 文本内均处理） */
  function replaceCodeInNode(node, code) {
    var src = node.getAttribute('src');
    if (src && src.indexOf(DANMU_JS) !== -1) {
      if (src.indexOf('channelCode=') !== -1) {
        node.setAttribute('src', src.replace(CODE_PARAM_RE, '$1' + code));
      } else {
        node.setAttribute('src', src + (src.indexOf('?') === -1 ? '?' : '&') + 'channelCode=' + code);
      }
    }
    var txt = node.textContent || '';
    if (txt.indexOf('channelCode=') !== -1) {
      node.textContent = txt.replace(CODE_PARAM_RE, '$1' + code);
    }
  }

  /* 处理已上传的 html：
   *   - 输入了新通道码：原通道码被替换；原本没有通道码则注入加载脚本
   *   - 未输入通道码：移除文档中已有的通道码加载脚本 */
  function processHtml(html, code) {
    var doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      throw new Error('HTML 解析失败：' + e.message);
    }

    var list = findDanmuScripts(doc);
    if (list.length) {
      if (code) {
        for (var i = 0; i < list.length; i++) replaceCodeInNode(list[i], code);
      } else {
        for (var j = 0; j < list.length; j++) {
          if (list[j].parentNode) list[j].parentNode.removeChild(list[j]);
        }
      }
    } else if (code) {
      var sc = doc.createElement('script');
      sc.textContent = danmuLoader(code);
      var body = doc.body || doc.documentElement;
      body.appendChild(sc);
    }

    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }

  /* ==================== 下载 ==================== */
  function triggerDownload(name, content) {
    var blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  /* ==================== 界面渲染 ==================== */
  function renderFileRow() {
    if (!file.name) {
      fileList.innerHTML = '<p class="empty">还没有文件</p>';
      return;
    }
    var statusTxt = file.channel
      ? (file.channelSrc === 'inject'
          ? '已注入通道码：' + escHtml(file.channel)
          : '已识别通道码：' + escHtml(file.channel))
      : (file.kind === 'md'
          ? '就绪 · 将转换为 HTML'
          : '就绪（HTML）');
    fileList.innerHTML =
      '<div class="fileitem">' +
      '<span class="fno">1</span>' +
      '<span class="fname">' + escHtml(file.name) + '</span>' +
      '<span class="fstatus">' + statusTxt + '</span>' +
      '</div>';
  }

  function renderCoder() {
    if (file.channel) {
      var meta = file.channelSrc === 'inject'
        ? '已注入到生成的 HTML 中'
        : '已从上传的 HTML 中识别';
      ccShow.innerHTML =
        '<span class="cc-code">' + escHtml(file.channel) + '</span>' +
        '<span class="cc-meta">' + meta + '</span>';
    } else {
      ccShow.innerHTML = '<p class="empty">提取出的通道码出现在这里</p>';
    }
  }

  /* 「添加通道码并下载」按钮后的提示：合法通道码时展示广告推送链接 */
  function renderAdTip() {
    var code = ccInput.value.trim();
    if (CHANNEL_RE.test(code)) {
      adLink.href =
        'https://www.phprm.com/services/push/send/' + code +
        '?head=%E5%B9%BF%E5%91%8A&body=&url=https%3A%2F%2Fpush.phprm.com%2F' +
        '&avatar=https%3A%2F%2Fws.phprm.com%2Fstatic%2Fdemo%2Fimages%2Fad-demo.svg';
      adLink.textContent = adLink.href;
      adTip.hidden = false;
    } else {
      adTip.hidden = true;
      adLink.href = '#';
    }
  }

  /* ==================== 文件读取 ==================== */
  function handleFiles(list) {
    if (!list || !list.length) return;
    if (list.length > 1) {
      setStatus(uploadStatus, '仅支持上传 1 个文件，请重新选择', 'err');
      return;
    }
    var f = list[0];
    if (!isMarkdown(f.name) && !isHtml(f.name)) {
      setStatus(uploadStatus, '仅支持 markdown 或 html 文件（.md / .markdown / .html / .htm）', 'err');
      return;
    }
    if (f.size > MAX_SIZE) {
      setStatus(uploadStatus, '文件超过 10MB 上限，请压缩后重试', 'err');
      return;
    }
var reader = new FileReader();
    reader.onload = function () {
      var channel = '';
      if (isHtml(f.name)) channel = extractChannelCode(String(reader.result || ''));
      file = {
        name: f.name,
        size: f.size,
        kind: isMarkdown(f.name) ? 'md' : 'html',
        text: String(reader.result || ''),
        channel: channel,
        channelSrc: channel ? 'upload' : ''
      };
      setStatus(uploadStatus, '已读取 ' + fmtSize(file.size) + '，可以在「加通道统计」面板生成 html 了', 'ok');
      step1.className = 'done';
      step2.className = 'now';
      renderFileRow();
      renderCoder();
    };
    reader.onerror = function () {
      setStatus(uploadStatus, '文件读取失败，请重试', 'err');
    };
    reader.readAsText(f, 'utf-8');
  }

  function resetAll() {
    file = { name: '', size: 0, kind: '', text: '', channel: '', channelSrc: '' };
    fileInput.value = '';
    ccInput.value = '';
    renderAdTip();
    setStatus(uploadStatus, '', '');
    setStatus(ccStatus, '', '');
    resetSteps();
    renderFileRow();
    renderCoder();
  }

  /* ==================== 「添加通道码并下载」 ==================== */
  btnChannel.addEventListener('click', function () {
    if (!file.name) {
      setStatus(ccStatus, '请先上传 markdown 或 html 文件', 'err');
      return;
    }
    var code = ccInput.value.trim();
    var AD_TIP = '可以双击打开，点击链接后页面右下角会出现示例广告，如需自定义广告推送请到官网创建通道，并准备320宽400高的广告图。';
    if (code && !CHANNEL_RE.test(code)) {
      setStatus(ccStatus, '通道码需为 32 位 16 进制字符串（0-9、a-f，共 32 位）', 'err');
      return;
    }

    try {
      var out, fname;
      if (file.kind === 'md') {
        fname = baseName(file.name) + '.html';
        out = buildHtmlFile(baseName(file.name), converter.makeHtml(file.text), code);
        setStatus(ccStatus,
          code ? '已生成带通道码的 ' + fname + '，' + AD_TIP : '未输入通道码，已生成不带通道码的 ' + fname,
          'ok');
      } else {
        var hadCode = !!file.channel;
        out = processHtml(file.text, code);
        fname = code
          ? baseName(file.name) + '-带通道码.html'
          : baseName(file.name) + '.html';
        if (code && hadCode) {
          setStatus(ccStatus, '原通道码已替换为 ' + code + '，文件已生成：' + fname + '，' + AD_TIP, 'ok');
        } else if (code) {
          setStatus(ccStatus, '通道码已注入，文件已生成：' + fname + '，' + AD_TIP, 'ok');
        } else if (hadCode) {
          setStatus(ccStatus, '未输入通道码，已生成移除原通道码的 ' + fname, 'ok');
        } else {
          setStatus(ccStatus, '未输入通道码，' + fname + ' 原样生成', 'ok');
        }
      }
      triggerDownload(fname, out);
      step2.className = 'done';
      step3.className = 'done';
      /* 注入后自动回填下方「提取内嵌通道码」 */
      file.channel = code;
      file.channelSrc = code ? 'inject' : '';
      renderFileRow();
      renderCoder();
    } catch (e) {
      setStatus(ccStatus, e && e.message ? e.message : '处理失败，请重试', 'err');
    }
  });

  /* ==================== 事件绑定 ==================== */
  /* 上传区 */
  dropzone.addEventListener('click', function () { fileInput.click(); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', function () { handleFiles(fileInput.files); });
  ccInput.addEventListener('input', renderAdTip);

  /* 清空重来 */
  btnReset.addEventListener('click', resetAll);

  /* ==================== 初始化 ==================== */
  resetSteps();
  renderFileRow();
  renderCoder();
  renderAdTip();
})();