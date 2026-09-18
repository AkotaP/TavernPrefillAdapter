# Tavern Prefill Adapter

统一处理不同 LLM Provider（OpenAI-Compatible API）对 **Assistant Content Prefill**、
**Reasoning / Thinking Prefill**、**Prefix Completion** 与 **Combined Prefill** 的不同实现。

目标：

> 你在 SillyTavern 里只用一种方式表达 Prefill 意图，插件负责把它翻译成各个 Provider
> 实际需要的协议格式。

```
SillyTavern Prefill 输入
        ↓
Prefill Parser（标签解析 → 统一内部模型）
        ↓
统一 Prefill Model { reasoning, content, mode, source }
        ↓
Provider Adapter（按 Provider 协议翻译）
        ↓
Provider-specific API Payload
```

---

## 目录

- [项目介绍](#项目介绍)
- [安装方法](#安装方法)
- [启用方法](#启用方法)
- [Auto 模式使用方法](#auto-模式使用方法)
- [Manual 模式使用方法](#manual-模式使用方法)
- [Custom Adapter 使用方法](#custom-adapter-使用方法)
- [Profile 管理](#profile-管理)
- [Provider 支持矩阵](#provider-支持矩阵)
- [Capability 说明](#capability-说明)
- [Debug 方法](#debug-方法)
- [已知限制](#已知限制)
- [安全说明](#安全说明)
- [开发与测试](#开发与测试)

---

## 项目介绍

SillyTavern 在 Chat Completion 模式下可以通过 **Start Reply With** / 回复前缀生成一个尾部
assistant 消息，表达“assistant 正文已经开始，从这里继续生成”。但不同 Provider 对 Prefill
（尤其是 Reasoning Prefill）的实现完全不同：

| Provider | 协议要点 |
| --- | --- |
| Ollama | assistant 消息带 `reasoning` 字段（映射为原生 thinking）；响应也返回 `reasoning` |
| Moonshot / Kimi | assistant 消息带 `reasoning_content` + `partial: true`（Partial Mode）；思考模式续接必须回传 `reasoning_content` |
| DeepSeek | assistant 消息带 `reasoning_content` + `prefix: true`（Beta 接口） |
| 通用 OpenAI 兼容 | 只保证 `{ role: "assistant", content } `，绝不发明 reasoning 字段 |

本插件：

- 用 **Auto 模式**解析 SillyTavern 生成的回复前缀里的“思考标签”，翻译成 Provider 需要的字段；
- 用 **Manual 模式**直接在发出请求里构造 Reasoning / Content 预填充（不依赖 Start Reply With）；
- 提供 **Adapter 架构**与 **Capability 声明系统**，每个 Provider 的能力显式可知；
- 提供 **Custom Adapter Profile 系统**（多 Profile、导入导出、迁移、脏状态保护）；
- **绝不修改聊天历史**，只处理即将发送的请求副本；
- **Fail Open**：任何解析 / 适配 / 校验错误都保留原始请求，绝不断掉生成；
- **调试日志自动脱敏**，绝不打印 API Key / Token / Cookie / Secret。

---

## 安装方法

插件是标准 SillyTavern UI Extension（无服务端插件依赖）。**当前 SillyTavern release 的
安装方式是按 Git 仓库克隆**（Install extension → 粘贴仓库 URL），zip 安装仅适用于手动复制。
我们仓库根目录即插件根目录（`manifest.json` 在根），满足直接安装要求。

### 方式 A（推荐，Git 仓库直装）

1. 把本仓库推到 GitHub（**必须是公开仓库**，SillyTavern 服务端直接 `git clone`，无凭据）。
2. 在 SillyTavern 的 **Extensions → Install extension** 粘贴仓库 URL，例如：
   ```
   https://github.com/<你的用户名>/TavernPrefillAdapter
   ```
   可选在 "Branch or tag name" 填 `main` 或 `v0.1.0`（不填默认分支）。
3. 服务端会 `git clone --depth 1` 到 `data/<user>/extensions/TavernPrefillAdapter/`，
   读取根目录 `manifest.json` 校验通过后即安装成功；刷新页面即可在 Extensions 面板看到。
4. **更新**：安装后的目录是一个 git 仓库，扩展面板的 "Update available" 按钮会自动
   `git pull` 拉取最新代码（无需重装）。

### 方式 B（手动复制，备用）

把本目录复制到：

- 当前用户：`data/<user-handle>/extensions/TavernPrefillAdapter/`
- 所有用户：`SillyTavern/public/scripts/extensions/third-party/TavernPrefillAdapter/`

刷新页面，Extensions 面板中会出现 **Tavern Prefill Adapter**。两种安装位置都会以
`/scripts/extensions/third-party/TavernPrefillAdapter/...` 被前端加载，代码无需区分。

要求：SillyTavern release 分支最新版（`minimum_client_version` 1.12.0+）。

> 说明：`package.json` 仅用于本地跑测试，SillyTavern 忽略它；`dist/TavernPrefillAdapter.zip`
> 是打包产物（被 gitignore），当前版本安装流程不消费 zip，仅作分发备用。

---

## 启用方法

1. 打开 **Extensions** 面板，展开 **Tavern Prefill Adapter**。
2. 勾选 **Enable**。
3. 选择 **Provider**：
   - `Auto Detect`：优先使用你在设置里的显式选择，无显式选择时按 Base URL → Chat Source 顺序检测；
     模型名不参与检测（同名模型可能来自官方 API、OpenRouter、中转或 Ollama，不可靠）。
   - 或直接指定 `Ollama` / `Moonshot / Kimi` / `DeepSeek Official` / `Generic OpenAI` / `Custom`。
4. 选择 **Mode**：`Auto` 或 `Manual`。
5. 其余设置按需调整（见下）。

**关闭插件 = SillyTavern 原始行为**：`Enable` 取消勾选后，请求不做任何修改、不留任何额外字段。

---

## Auto 模式使用方法

Auto 模式负责解析 SillyTavern **已经生成**的回复前缀（典型来源：Advanced Formatting →
Start Reply With / 回复前缀）。

在请求即将发给 Provider 前，插件读取最终消息数组，**只有当最后一条是当前 Assistant Prefill
时**才处理；历史 Assistant 消息永远不会被改动（含标签文本的历史消息也安全）。

### 标签语法（默认，均可配置）

- Reasoning Start Tag（默认 `*thinking*`）
- Reasoning End Tag（默认 `*response*`）

| 输入（Start Reply With 内容） | 解析结果 |
| --- | --- |
| `她轻轻推开门，` | `{ reasoning:"", content:"她轻轻推开门，" }` —— 普通 Content Prefill |
| `*thinking*\n先分析当前人物状态……` | `{ reasoning:"先分析当前人物状态……", content:"" }` —— 未闭合 Reasoning（续思考意图） |
| `*thinking*\n先分析一下\n*response*\n她犹豫了一下，` | `{ reasoning:"先分析一下", content:"她犹豫了一下，" }` —— Completed Reasoning + Content |

标签可改成任意自定义标签，例如 `<scratchpad>` / `</scratchpad>`（在设置里修改
Reasoning Start/End Tag）。

解析规则：CRLF 归一化、标签必须在开头（忽略前导空白）、reasoning 保留内部空白、
支持空 reasoning / 空 content；格式异常一律 **Fail Open**（保持原始请求）。

### Auto 模式的判断策略（重要限制）

当前 SillyTavern release 里，主流程的 **Start Reply With 只对 Claude source 生效**
（`assistant_prefill` 请求字段，由 ST 核心处理）；对其它 Chat Completion source，
尾部 assistant prefill 消息由“预设/manual 注入/其它扩展”产生。因此 Auto 模式采用如下
保守启发式（详见 [已知限制](#已知限制)）：

- `normal / regenerate / swipe`：尾部 assistant 消息 = 当前 prefill（ST 正常请求不会以
  assistant 消息结尾，除非有人注入了 prefill）；
- `continue`：尾部 assistant 是续写目标，只有内容以 Reasoning Start Tag 开头时才当作
  prefill（与 KimiThinkingPrefill 行为一致）；
- 若消息带显式标记（`is_prefill: true` 等）则优先采用；
- `impersonate / quiet / 其它`：不处理。

---

## Manual 模式使用方法

Manual 模式不依赖 SillyTavern 的 Start Reply With；插件直接在最终请求中构造当前
Assistant Prefill。设置里的两个多行输入框：

- **Reasoning Prefill**：思考 / 分析文本（可为空）
- **Content Prefill**：assistant 正文前缀（可为空）

支持三种组合：

| Reasoning | Content | 行为 |
| --- | --- | --- |
| 有 | 空 | Reasoning Only（续思考意图；各 Provider 是否真正支持由 Adapter 判断） |
| 空 | 有 | Content Only |
| 有 | 有 | Both（Reasoning + Content 组合） |

Manual 配置**优先**于 Start Reply With：如果请求尾部已有一个 assistant prefill 消息，
插件会**替换**它而不是再追加一条 —— 保证“Assistant Prefill 只出现一次”。

---

## Custom Adapter 使用方法

1. **Provider 选择 `Custom`**，Custom Adapter 设置区会显示。
2. 在 **Custom Profile** 下拉里选择或新建 Profile。
3. 配置字段映射与附加字段（JSON）：
   - **Reasoning Field**：写思考内容的字段名，例如 `reasoning_content`
   - **Content Field**：正文字段名，例如 `content`
   - **Assistant Fields**：附加到 prefill assistant 消息上的字段，例如 `{ "partial": true }`
   - **Request Fields**：请求级额外字段，例如 `{ "include_reasoning": true }`
4. 设置 **Capabilities**（见 [Capability 说明](#capability-说明)）。
5. 点 **Save**（Save As 可另存新 Profile）。

例如“OpenRouter Kimi”Profile：

```jsonc
{
    "version": 1,
    "id": "...",
    "name": "OpenRouter Kimi",
    "reasoningField": "reasoning_content",
    "contentField": "content",
    "assistantFields": { "partial": true },
    "requestFields": { "include_reasoning": true },
    "capabilities": {
        "supportsContentPrefill": true,
        "supportsReasoningPrefill": true,
        "supportsCombinedPrefill": true,
        "supportsReasoningContinuation": false,
        "reasoningContinuationExperimental": false,
        "supportsToolsWithPrefill": false,
        "supportsStructuredOutputWithPrefill": false
    }
}
```

生成效果（reasoning=AAA, content=BBB）：

```json
{
    "messages": [
        { "role": "assistant", "reasoning_content": "AAA", "content": "BBB", "partial": true }
    ],
    "include_reasoning": true
}
```

手动选择 `Custom` Profile 时，**Auto Detect 不会覆盖它**；手动选择优先级最高。

---

## Profile 管理

Custom Profile 支持：

- **New**：新建空 Profile
- **Save**：校验并覆盖当前 Profile（不合法则拒绝保存并提示原因）
- **Save As**：基于当前配置另存为新 Profile
- **Rename** / **Duplicate** / **Delete**：重命名 / 复制 / 删除
- **Import Profile** / **Export Profile**：单个 Profile JSON 导入 / 导出
  - 导入流程：Parse JSON → 校验 schema（version / name / 字段类型 / capabilities）→
    迁移 → 入库；非法 JSON 或缺失 version 拒绝导入，不会覆盖现有配置；
    **ID 冲突时自动生成新 ID**，不覆盖（除非用户显式选择覆盖）。
- **切换**：切换 Profile 时若有未保存修改，会弹出 **Save / Discard / Cancel**，不会悄悄丢数据。

所有 Profile 持久化在 SillyTavern Extension Settings 中，浏览器刷新 / 重启后仍然存在。
删除当前正在使用的 Profile 会安全回退到 Generic，不会报错。

Profile 含 `version` 字段；插件后续升级通过 `migrateProfile()` 提供 v1 → v2 → … 迁移链。

---

## Provider 支持矩阵

> 以下结论基于开发时（SillyTavern release 分支、Ollama / Moonshot / DeepSeek 官方文档与源码）
> 的验证，见 [已知限制](#已知限制) 中的实现依据说明。

| Provider | Content | Reasoning | Combined | Reason Continue | 备注 |
| --- | --- | --- | --- | --- | --- |
| Ollama（本地 / 云 / OpenAI 兼容） | Yes | Yes（默认开启） | Yes（默认开启） | 实验性 | `reasoning` 字段 ↔ 原生 thinking；不按模型名判断 |
| Moonshot / Kimi | Yes | Yes | Yes | 实验性（空 content 可能重新开始生成） | `reasoning_content` + `partial: true`，思考续接需回传 `reasoning_content` |
| DeepSeek Official | Yes | Yes | Yes | 实验性 | `reasoning_content` + `prefix: true`，需 /beta 端点 |
| Generic OpenAI | Yes | No | No | No | 只保证 content prefill，reasoning 视为不支持 |
| Custom Profile | 按配置 | 按配置 | 按配置 | 按配置 | 由 Profile 的 Capabilities 决定 |

- **Ollama**：适配器检测 Custom source 的 Base URL（`localhost:11434` / `127.0.0.1:11434` /
  `ollama.com`）或手动选择 Ollama；把 reasoning 预填充写入 assistant 消息 `reasoning` 字段
  （Ollama 服务端将其映射为原生 thinking）。**默认开启**，刻意不做模型名匹配（模型迭代太快，
  名字不可靠）；无 thinking 支持的模型通常会忽略该字段（自然降级），若 Provider 拒绝则请求
  失败并保持 Fail Open，发送时 Debug 日志会提示。续思考标记为“实验性”（模型可能把 reasoning
  仅当作历史上下文）。
- **Moonshot / Kimi**：直接 Moonshot source、或任何支持 Partial Mode 的网关 / OpenRouter
  （模型名含 kimi/moonshot 的弱提示可自动路由到 Moonshot 适配器，可被手动选择覆盖）。Kimi K3 的
  thinking 模式要求回传 `reasoning_content`，通过「Advanced → Preserve Historical Reasoning」
  开启（默认关）。
- **DeepSeek Official**：ST 的 DeepSeek source 后端已默认使用 `https://api.deepseek.com/beta`
  并自动标记尾部 assistant 为 `prefix: true`；本插件补充 `reasoning_content`。若你用
  **Custom source** 直连 DeepSeek，插件会检测 Base URL 并**警告**（默认不静默改 URL）；
  勾选「Auto-adjust DeepSeek base URL」后才会在请求里把 `api.deepseek.com`（无 /beta）改写为
  `api.deepseek.com/beta`。
- **Generic OpenAI**：任何 OpenRouter / OpenAI / 自建网关等一律只做 content prefill；
  reasoning 预填充默认跳过（fail open）或仅保留 content 部分并在 Debug 日志提示。
- **Claude**：ST 核心已有自己的 `assistant_prefill` 机制，本插件不处理（自动跳过）。

---

## Capability 说明

每个 Adapter 显式声明能力（Custom Profile 由用户设置）：

- **Supports Content Prefill**：正文预填充
- **Supports Reasoning Prefill**：思考预填充
- **Supports Combined Prefill**：思考 + 正文组合
- **Supports Reasoning Continuation**：是否真正支持“从思考尾部继续生成”
- **Reasoning Continuation Experimental**：实验性标记（字段能发出去 ≠ Provider 语义真支持）
- **Supports Tools with Prefill**：tools / function calling 时是否允许 prefill
- **Supports Structured Output with Prefill**：response_format / json_schema 时是否允许 prefill

UI 依据 Capability：禁用/提示不支持的选项、显示实验性警告；请求时若冲突则**跳过 prefill 并
记录原因**，不会让请求 400。例如：

```
Skipped: tools are active and the current adapter does not support prefill with tools.
```

---

## Debug 方法

勾选 **Advanced → Debug Mode** 后：

- **酒馆界面内**：扩展设置面板底部出现 **Debug Log** 区域，插件日志实时显示（自动脱敏，
  最多 300 行，可一键 Clear；警告与错误即使不开 Debug 也会记录）。无需浏览器控制台。
- **浏览器控制台**（F12）同步输出（示例）：

```
[Tavern Prefill Adapter] Provider: ollama | via: url | Mode: auto | Adapter: OllamaAdapter | Capabilities: content:yes reasoning:yes combined:yes continue:no* tools:no structured:no | Intent: both
```

Debug 输出包括：检测到的 Provider / 选中的 Adapter / Capabilities / 解析出的 Prefill /
转换结果 / 请求级附加字段 / 跳过原因。**所有日志都经过脱敏**（详见安全说明）。

---

## 已知限制

1. **Auto 模式依赖“尾部 assistant 消息”启发式**：当前 SillyTavern release 的
   *Start Reply With 仅对 Claude source 生效*（见 §Auto 模式判断策略）。若你的 Chat Completion
   flow 里没有注入尾部 assistant prefill，Auto 模式不会主动追加（那是 Manual 模式的职责）。
   未来 ST 若提供可靠的 prefill 标记（如 `is_prefill`），插件会优先采用（已预留判断逻辑）。
2. **Reasoning Only 预填充 ≠ 原生续思考**：`reasoning` / `reasoning_content` /
   `prefix` 字段存在不代表 Provider 会把生成光标放在思考尾部。Ollama 原生注释也确认
   “gpt-oss 无法区分继续思考与结束思考输出正文”，因此该能力默认标记为**实验性**。
3. **Moonshot 空 content**：Kimi 官方文档说明 Partial Mode 的 prefix 为空时可能从零重新生成，
   所以 reasoning-only prefill 是实验性能力。
4. **DeepSeek /beta**：prefix completion 需要 `api.deepseek.com/beta`；ST 原生 DeepSeek source
   已满足。用 Custom 直连时请自行确保 /beta 或开启自动调整设置。
5. **纯 Content Prefill（无 thinking 标签）在 Auto 模式下不做 Provider 翻译**：尾部 assistant
   消息本身就是 OpenAI 语义下的 content prefill，插件保持原样（最安全）。Moonshot 上如需
   `partial: true`，请使用 Manual 模式或带 tags 的前缀。
6. **Tools / Structured Output 冲突时直接跳过 prefill**（不拆分、不冒险），这是参考设计与
   KimiThinkingPrefill 一致的保守行为。
7. **不处理响应解析**：第一版只做 Outgoing Request 翻译；响应侧 `reasoning` /
   `reasoning_content` 的展示由 SillyTavern 核心负责。Response Adapter 已在架构上预留
   （新目录加 Adapter 即可），但非本版必选。

### 实现依据（外部实现核对结果）

- SillyTavern release：`public/scripts/openai.js` 的 `sendOpenAIRequest()` 在 POST
  `/api/backends/chat-completions/generate` 前发出 `CHAT_COMPLETION_SETTINGS_READY`，
  参数为最终 `generate_data` —— 本插件挂在这个时机。
- Ollama：`openai/openai.go` `FromChatRequest()` 把 OpenAI 消息的 `reasoning` 字段映射为
  原生 `thinking`；响应把原生 thinking 暴露为 `message.reasoning`。
- Moonshot/Kimi：平台文档「Use Partial Mode」+ `Rurijian/KimiThinkingPrefill`
  （`reasoning_content` + `partial:true` + `include_reasoning`）。
- DeepSeek：官方 Chat Completions API 文档的 Beta 字段 `prefix` / `reasoning_content`；
  ST 后端 `src/endpoints/backends/chat-completions.js` 的 `sendDeepSeekRequest()` 已加
  `addAssistantPrefix(..., 'prefix')` 并默认 `API_DEEPSEEK = https://api.deepseek.com/beta`。

---

## 安全说明

- Debug 日志**强制脱敏**：`Authorization`、`api_key`、`token`、`secret`、
  `password`、`cookie`、`proxy_password`、`custom_include_headers`、
  `custom_url`（可能内嵌凭据）等一律输出为 `[REDACTED]`；循环引用与函数也安全处理。
- 插件绝不把内部标志写回聊天历史；转换只发生在即将发送的请求副本上。
- 插件错误被 try/catch 隔离：Fail Open，恢复原始请求，不影响聊天。

---

## 开发与测试

```bash
npm test        # 运行 Node 单元测试（无需 SillyTavern）
```

覆盖：Prefill Parser、Provider 自动检测、各 Provider Adapter（含 tools/structured 冲突）、
通用/custom 转换、Profile 管理（增删改查/导入导出/持久化/脏状态/ID 冲突）、日志脱敏、
请求转换端到端（Off 模式零改动、防重复处理、错误隔离）。

### 目录结构

```
TavernPrefillAdapter/
├── manifest.json
├── index.js                 # 扩展入口：挂 CHAT_COMPLETION_SETTINGS_READY
├── settings.html
├── style.css
├── package.json             # 仅用于本地测试
├── src/
│   ├── core/
│   │   ├── capabilities.js
│   │   ├── prefill-parser.js
│   │   ├── provider-detector.js
│   │   ├── request-transformer.js
│   │   ├── settings-manager.js
│   │   └── logger.js        # 日志脱敏
│   ├── adapters/
│   │   ├── base-adapter.js
│   │   ├── ollama-adapter.js
│   │   ├── moonshot-adapter.js
│   │   ├── deepseek-adapter.js
│   │   ├── generic-openai-adapter.js
│   │   ├── custom-adapter.js
│   │   └── index.js         # AdapterRegistry
│   ├── profiles/
│   │   ├── profile-manager.js
│   │   ├── profile-validator.js
│   │   └── profile-migrations.js
│   └── ui/
│       ├── settings.js
│       └── profile-editor.js
└── tests/                   # node:test 单元测试
```

## License

MIT（按官方扩展仓库要求为 libre license）。
