# 图片反推提示词浏览器插件

一个 Manifest V3 Chrome/Edge 扩展 MVP：右键网页图片，调用支持视觉输入的 Kimi/OpenAI-compatible 接口，提取一段可迁移的风格提示词。

当前版本：`v0.1.2`

## 版本记录

- `v0.1.2`：极简风格提示词模式，只输出一段中文风格提示词，移除 JSON、主体模板、改写控件和多余复制按钮。
- `v0.1.1`：快模式输出，新增主体填空模板，AI 生成 45-50 秒未返回时自动中断，弹窗显示版本号。
- `v0.1.0`：基础右键图片分析、API 绑定、结果浮窗和复制功能。

## 文件说明

- `manifest.json`：扩展权限、右键菜单和后台 service worker 声明；不再把 content script 常驻注入所有网页。
- `background.js`：右键菜单、API URL/Key 检查、图片 URL 转 Base64、AI 接口调用、极简风格提示词和进度通知。
- `popup.html` / `popup.js`：API URL、API Key、模型名称绑定、保存、清除。
- `content.js`：页面内进度条、错误提示、结果浮窗和复制按钮；只展示一段风格提示词，不会在网页里接收 API Key。
- `style.css`：popup 扁平风格样式。网页浮窗样式使用 Shadow DOM 内联隔离，避免污染原网页。

## 本地加载

1. 打开 Chrome/Edge 的扩展管理页。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录：`/Users/apple/work/google插件/reverse-image-prompt-extension`。
5. 点击浏览器右上角扩展图标，填写 API URL、API Key 和模型名称，点击“检测并绑定”。
6. 在网页图片上右键，点击“反推图片提示词”。

API Key 只在扩展弹窗中输入，不会在网页浮窗里输入。

## 怎么拿去生图

插件现在只返回一段风格提示词。使用时，把你想生成的新主体写在前面，再接插件给出的风格提示词。

```text
一位撑伞的年轻侦探站在雨夜街角，手里拿着档案袋，黑白胶片质感，大面积近黑色留白，低照度侧光，粗粝银盐颗粒，旧纸张磨损质感，克制哀伤的东方文艺电影海报气质
```

## API URL 规则

默认值是：

```text
https://api.moonshot.cn/v1/chat/completions
```

也可以直接填写 Kimi/Moonshot base URL：

```text
https://api.moonshot.cn/v1
```

也支持 OpenAI-compatible 的 Chat Completions 接口：

```text
https://your-api-host.example.com/v1/chat/completions
```

如果填写的是域名根路径或 `/v1`，非 OpenAI 官方域名会自动补为 `/v1/chat/completions`。检测成功后会保存实际可用的完整接口地址。

模型名称默认是 `kimi-k2.6`。如果账号没有开放该模型，可以在弹窗里改成账号已开放的 Kimi 视觉模型，例如 `moonshot-v1-8k-vision-preview`。

API Key 通过 `chrome.storage.local` 保存在本机浏览器扩展存储中，不会写入代码文件，也不会随浏览器账号同步。

## 隐私边界

- 只有右键图片并点击菜单时，插件才会动态注入页面浮窗脚本。
- 图片会被读取、压缩并发送到你配置的 API 服务商用于分析。
- 不建议处理客户资料、内网页面、证件、合同、聊天截图等敏感图片。

## 耗时预期

- 常规网页图片通常应在 20-50 秒内返回。
- 插件会把图片压缩到最长边 1024px，并在 45-50 秒 AI 请求未返回时自动停止并提示错误。
- 如果连续超时，通常是模型渠道排队、网关慢或原图过大；可以稍后重试或换更小的图片。
