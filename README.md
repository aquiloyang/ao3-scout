# AO3 Scout

> AI 驱动的 AO3 同人文质量分析工具 · 30 秒判断一篇文是否值得读

[![Version](https://img.shields.io/badge/version-1.0.0-E06C75?style=flat-square)](https://github.com/aquiloyang/ao3-scout/releases)
[![License](https://img.shields.io/badge/license-MIT-6C7086?style=flat-square)](LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-required-A6E3A1?style=flat-square)](https://www.tampermonkey.net/)

---

## 功能简介

在 AO3 文章页点击右下角浮动按钮，30 秒内获得：

- **综合评分**（1-10 分，带评分环）
- **五维度分析**：逻辑严密度 / 人物塑造 / 叙事节奏 / 情感张力 / 原创性，每项附原文引用佐证
- **雷点警告**：自动识别 OOC、逻辑硬伤、文风问题等，附原文片段
- **最精彩片段**：AI 提取最能体现文笔风格的段落（防剧透）
- **个性化评分**：根据你填写的口味偏好（文笔 / 情感 / 节奏 / CP）调整权重

---

## 安装（5 分钟，4 步）

### 前置要求

- Chrome 浏览器 + [Tampermonkey 扩展](https://www.tampermonkey.net/)
- [AIHubMix](https://aihubmix.com) 账号（AI 分析费用由用户自己的 Key 承担，约 ¥0.028/次）
- GitHub 账号（用于身份认证，仅读取用户名）

### 安装步骤

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击下方链接一键安装脚本：

   **[📥 安装 AO3 Scout](https://raw.githubusercontent.com/aquiloyang/ao3-scout/main/tampermonkey/ao3-ai-scout.user.js)**

3. 打开任意 AO3 页面，点击右下角红色 ✦ 按钮
4. 按引导完成：GitHub 登录 → 填写口味偏好 → 填写 AIHubMix API Key

完成后即可使用。

---

## 使用方式

| 操作 | 行为 |
|---|---|
| 文章页单击 ✦ | 触发 AI 分析，侧滑面板展示结果 |
| 鼠标悬停在 ✦ 上 | 展开 Speed Dial 子菜单 |
| 子菜单 ⚙ 设置 | 更换 API Key、切换分析模型 |
| 面板右上角 × 或 ESC | 关闭侧滑面板 |

### 分析模型

设置面板可切换三档：

| 档位 | 模型 | 费用/次 | 推荐场景 |
|---|---|---|---|
| 🚀 高品质 | Gemini 2.5 Pro | ¥0.128 | 重点文章精读 |
| ⚖ 均衡（默认）| DeepSeek V3 | ¥0.028 | 日常使用 |
| 💰 省钱 | Gemini 2.5 Flash | ¥0.010 | 快速筛选 |

---

## 架构

```
┌─────────────────┐     JWT      ┌──────────────────────┐
│  Tampermonkey   │ ──────────► │  Cloudflare Worker   │
│  (Chrome 桌面)  │ ◄────────── │  ao3scout.workers.dev│
└─────────────────┘   JSON 结果  └──────────┬───────────┘
                                            │
                              ┌─────────────▼─────────────┐
                              │      Cloudflare D1         │
                              │  users / preferences /     │
                              │  analysis_cache / stats    │
                              └───────────────────────────┘
```

- **Tampermonkey 脚本**：AO3 页面注入，负责 DOM 抓取、UI 渲染、用户交互
- **Cloudflare Worker**：统一 API 层，处理认证 / AI 代理 / 数据 CRUD
- **Cloudflare D1**：SQLite 数据库，存储用户数据和分析缓存
- **AIHubMix**：OpenAI 兼容聚合 API，费用由用户自己的 Key 承担

---

## 隐私说明

- GitHub OAuth 仅读取用户名（`read:user` scope），不访问任何仓库或私有数据
- AIHubMix API Key 经 **AES-256-GCM** 加密后存储在服务器，脚本本身不持有明文
- AO3 账号（可选）同样加密存储，仅用于分析需要登录才能查看的 M/E 级内容
- 分析内容（文章正文片段）仅用于本次 AI 调用，不做其他用途

---

## 费用参考

| 使用强度 | 次数/天 | 月费用（均衡档）|
|---|---|---|
| 轻度 | 3 次 | ≈ ¥2.5 |
| 中度 | 10 次 | ≈ ¥8.5 |
| 重度 | 20 次 | ≈ ¥17 |

---

## Roadmap

- [x] v1.0.0 — 核心分析功能（评分 / 维度 / 雷点 / 偏好校准）
- [ ] v2.0.0 — 稍后看列表 / 私人笔记 / 阅读日志 / 手机端
- [ ] v3.0.0 — 每日自动扫文推荐 / 首页推荐横幅

---

## License

MIT © [aquiloyang](https://github.com/aquiloyang)
