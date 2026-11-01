# Markdown 转 HTML（离线版）

复刻自 [即时工具 · markdown转html](https://www.67tool.com/work/mdToHtml) 的**纯前端**离线包。

## 结论：纯前端方案

经对页面 Nuxt chunk 源码分析确认，该工具为 **100% 浏览器本地运行**，不上传任何数据（页面亦明确标注「纯前端实现不上传服务器」）：

- **解析引擎**：Showdown（`showdown.min.js`，v2.0.0-alpha1，约 80KB），随包内置。
- **加载方式**：页面用 `loadScript('/js/showdown.min.js')` 引入本地库，再 `new showdown.Converter()`。
- **转换逻辑**（本地调用）：
  ```js
  const converter = new showdown.Converter();
  const html = converter.makeHtml(markdownText);   // 浏览器本地 Markdown -> HTML
  // -> Blob -> 本地触发下载
  ```
- 平台的上传接口（`/api/v1/*`）仅服务于视频/音频/PDF 等工具，Markdown→HTML 转换**不走服务器上传**。

## 目录结构

```
md2html/
├── index.html            # 页面入口
├── css/style.css         # 样式
├── js/app.js             # 转换与下载逻辑（纯前端）
├── vendor/
│   └── showdown.min.js   # Showdown（Markdown -> HTML）解析库
└── README.md
```

## 使用方法

1. 解压 ZIP，得到 `md2html` 文件夹。
2. **推荐**用本地静态服务器打开（避免个别浏览器对 `file://` 的限制）：
   ```bash
   cd md2html
   python3 -m http.server 8080
   # 浏览器访问 http://localhost:8080
   ```
   也可直接双击 `index.html`。
3. 拖入 / 选择 `.md` / `.markdown` / `.txt` 文件（支持批量，最多 5 个，单个 ≤5MB）。
4. 点击「开始转换」在本地生成 HTML，然后逐个「下载」或「下载全部」。

## 说明

- 完全离线：转换过程不产生任何网络请求。
- 上传限制（最多 5 个、单个 ≤5MB）与原站保持一致。
- 本离线包仅用于本地学习与备份用途，原工具版权归即时工具（深圳市搜图信息科技有限公司）所有。
