# 图片反推提示词浏览器插件

一个 Manifest V3 Chrome/Edge 扩展 MVP：右键网页图片，选择视觉模型服务商，调用支持视觉输入的 API 提取可迁移画面语法；输入新主体后，再生成一段可直接用于生图的完整提示词。

当前版本：`v0.2.1`

## 版本记录

- `v0.2.1`：新增模型服务商预设：Kimi、MiMo、Gemini、ChatGPT/OpenAI、自定义 OpenAI-compatible；Gemini 使用原生 generateContent 调用，主体适配也支持 Gemini。
- `v0.2.0`：从“只提取风格提示词”升级为“画面语法 + 主体适配”。结果浮窗支持输入新主体，生成完整生图提示词，同时保留主体放置模板。
- `v0.1.2`：极简风格提示词模式，只输出一段中文风格提示词，移除 JSON、主体模板、改写控件和多余复制按钮。
- `v0.1.1`：快模式输出，新增主体填空模板，AI 生成 45-50 秒未返回时自动中断，弹窗显示版本号。
- `v0.1.0`：基础右键图片分析、API 绑定、结果浮窗和复制功能。

## 文件说明

- `manifest.json`：扩展权限、右键菜单和后台 service worker 声明；不再把 content script 常驻注入所有网页。
- `popup.html` / `popup.js`：模型服务商、API URL、API Key、模型名称绑定、保存、清除。
- `background.js`：右键菜单、API URL/Key 检查、图片 URL 转 Base64、画面语法提取、主体适配、模型供应商路由和进度通知。
- `content.js`：页面内进度条、错误提示、结果浮窗、主体输入、完整提示词生成和复制按钮；不会在网页里接收 API Key。
- `style.css`：popup 扁平风格样式。网页浮窗样式使用 Shadow DOM 内联隔离，避免污染原网页。

## 本地加载

1. 打开 Chrome/Edge 的扩展管理页。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录：`/Users/apple/work/google插件/reverse-image-prompt-extension`。
5. 点击浏览器右上角扩展图标，选择服务商，填写 API Key，必要时调整 API URL 和模型名称，点击“检测并绑定”。
6. 在网页图片上右键，点击“反推图片提示词”。

API Key 只在扩展弹窗中输入，不会在网页浮窗里输入。

## 怎么拿去生图

插件会先返回参考图的“画面语法”和“主体放置模板”。在结果浮窗里输入你想生成的新主体，点击“生成完整提示词”，插件会再调用一次模型，把主体嵌入构图、光影、空间和材质里。

```text
一只复古机械手表静置在暗色木桌边缘，表盘被低照度侧光轻轻勾亮，背景大面积近黑色留白，浅景深压低环境信息，黑白胶片质感，粗粝银盐颗粒，微弱高光落在金属边缘，冷静、克制、带有旧电影海报般的孤独气质。
```

## 模型服务商

内置预设：

- `Kimi / Moonshot`：`https://api.moonshot.cn/v1/chat/completions`，默认模型 `kimi-k2.6`
- `MiMo`：`https://api.mimo-v2.com/v1/chat/completions`，默认模型 `mimo-v2-omni`
- `Gemini`：`https://generativelanguage.googleapis.com/v1beta`，默认模型 `gemini-2.5-flash`
- `ChatGPT / OpenAI`：`https://api.openai.com/v1/chat/completions`，默认模型 `gpt-4.1-mini`
- `自定义 OpenAI-compatible`：用于 OpenRouter、SiliconFlow、本地网关或其他兼容 Chat Completions 视觉输入的接口

## API URL 规则

Kimi/MiMo/OpenAI-compatible 可以填写完整 Chat Completions 地址：

```text
https://api.moonshot.cn/v1/chat/completions
```

也可以直接填写 base URL：

```text
https://api.moonshot.cn/v1
```

也支持 OpenAI-compatible 的 Chat Completions 接口：

```text
https://your-api-host.example.com/v1/chat/completions
```

如果填写的是域名根路径或 `/v1`，非 OpenAI 官方域名会自动补为 `/v1/chat/completions`。检测成功后会保存实际可用的完整接口地址。

Gemini 预设填写 base URL 即可，插件会自动拼接 `/models/{model}:generateContent`。

API Key 通过 `chrome.storage.local` 保存在本机浏览器扩展存储中，不会写入代码文件，也不会随浏览器账号同步。

## 隐私边界

- 只有右键图片并点击菜单时，插件才会动态注入页面浮窗脚本。
- 图片会被读取、压缩并发送到你配置的 API 服务商用于分析。
- 不建议处理客户资料、内网页面、证件、合同、聊天截图等敏感图片。

## 耗时预期

- 常规网页图片通常应在 20-50 秒内返回。
- 插件会把图片压缩到最长边 1024px，并在 45-50 秒 AI 请求未返回时自动停止并提示错误。
- 如果连续超时，通常是模型渠道排队、网关慢或原图过大；可以稍后重试或换更小的图片。
