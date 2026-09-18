# AGENTS.md — Tavern Prefill Adapter 开发指南

> 本文件面向在此仓库中工作的 Agent（DeepSeek Harness 会话 / 协作者）。它是项目级的
> 工作指引；与用户直接指令冲突时以用户指令为准。

## 项目是什么

**Tavern Prefill Adapter** 是一个可安装运行的 SillyTavern UI Extension（无服务端插件依赖）。
它把用户的统一 Prefill 意图（assistant 正文前缀 / reasoning 思考前缀 / 组合前缀）翻译成
不同 LLM Provider（Ollama、Moonshot/Kimi、DeepSeek、通用 OpenAI 兼容、自定义网关）各自需要的
请求协议字段。

数据流：

```
SillyTavern Prefill 输入 → Prefill Parser → 统一 Prefill Model → Provider Adapter → Provider API Payload
```

## 目录结构与分层（禁止混层）

| 目录 | 职责 | 依赖限制 |
| --- | --- | --- |
| `index.js` | 扩展入口；唯一挂事件 / 初始化 UI 的地方 | 浏览器全局 OK |
| `src/core/` | 纯逻辑：parser / detector / transformer / settings / capabilities / logger | **不得引用浏览器全局**（`SillyTavern`、`$`、`document`、`jQuery`），保证可在 Node 单测 |
| `src/adapters/` | Provider 协议翻译；每个 adapter 显式声明 capabilities | 同 core（纯逻辑） |
| `src/profiles/` | Custom Profile 管理 / 校验 / 迁移 | 同 core |
| `src/ui/` | 设置面板 UI（jQuery/DOM） | 浏览器全局 OK |
| `tests/` | `node:test` 单元测试，无需 SillyTavern | Node only |

标签解析（parser）、Provider 判断（detector）、字段转换（adapter）、UI 状态（ui）**严禁**混在同一个函数里。

## 核心机制（改代码前必读）

1. **Hook 时机**：SillyTavern release 的 `public/scripts/openai.js` → `sendOpenAIRequest()`
   在 POST `/api/backends/chat-completions/generate` 前发出 `CHAT_COMPLETION_SETTINGS_READY`，
   参数是最终 `generate_data`。请求转换必须挂在这个时机：请求已构造、尚未发送。
2. **统一 Prefill Model**：`{ reasoning: string, content: string, mode: 'content'|'reasoning'|'both', source: 'start-reply-with'|'manual' }`。
3. **Fail Open**：任何 parse/adapter/validate 错误都保留原始请求；绝不阻断 / 改坏聊天请求。
4. **只处理请求副本**：绝不修改 SillyTavern 聊天历史（`chat[]`）；转换只作用于请求对象。
5. **防重复处理**：`request-transformer.js` 用模块级 `WeakSet` 标记已处理的 `generate_data`。
6. **Off 模式**：`enabled=false` 时请求必须与未安装插件完全一致（不得残留任何字段）。
7. **日志脱敏**：Debug 日志一律经 `src/core/logger.js` 的 `redact()`——API Key / Token /
   cookie / `custom_url` / headers 等敏感值输出为 `[REDACTED]`。禁止裸打请求体。
8. **Capability 声明**：adapter 必须显式声明 `supportsContentPrefill / supportsReasoningPrefill /
   supportsCombinedPrefill / supportsReasoningContinuation / reasoningContinuationExperimental /
   supportsToolsWithPrefill / supportsStructuredOutputWithPrefill`；tools / structured output
   冲突时跳过 prefill，而不是发 400。
9. **Reasoning Continuation 不能乱宣称**：字段能发出去 ≠ Provider 语义真支持“从思考尾部继续生成”，
   一律标实验性或按模型 gating。

## Provider 协议速查（详见 README「实现依据」）

| Provider | 消息字段 | 请求级 | 备注 |
| --- | --- | --- | --- |
| Ollama | `reasoning`（↔ 原生 thinking） | — | reasoning prefill 默认开启；**禁止用模型名判断能力**（模型迭代快）；续思考实验性 |
| Moonshot/Kimi | `reasoning_content` + `partial: true` | `include_reasoning` | 思考续接需回传 `reasoning_content` |
| DeepSeek | `reasoning_content` + `prefix: true`（Beta） | `include_reasoning` / `thinking` | 需 `api.deepseek.com/beta`；默认只警告不静默改 URL |
| Generic OpenAI | 仅 `content` | — | 绝不发明 reasoning 字段 |
| Custom Profile | 用户配置字段 | 用户配置字段 | 由 Profile capabilities 决定 |

## 版本与发布

- 版本号**双维护**：`manifest.json` 与 `package.json` 的 `version` 必须一致（当前 `0.2.1`，以 manifest 为准）。
- **安装方式（当前 ST release）**：Install extension 填 GitHub 公开仓库 URL，服务端
  `git clone` 到 `data/<user>/extensions/<repo名>`，要求仓库**根目录**有合法
  `manifest.json`（本项目满足）。仓库必须是 public。
- 目录名 = 仓库 URL 最后一段（去掉 .git），所以不要在仓库里套一层同名子目录。
- `dist/TavernPrefillAdapter.zip` 是打包产物（已 gitignore）：当前安装流程不消费 zip，
  仅作分发备用；如需重新生成，排除 tests/dist/start.md。

## 验证

```bash
npm test          # 全部单元测试（node --test，无需 SillyTavern）
```

- 修改 `src/core`、`src/adapters`、`src/profiles` 逻辑必须补充/更新对应 `tests/*.test.js`。
- 改完后跑 `npm test` 全绿再交付；同时可用 `node --check` 对每个 .js 做语法校验。

## 已知限制（完整版见 README）

- 当前 ST release 主流程的 Start Reply With 只对 Claude source 生效，因此 Auto 模式采用
  “尾部 assistant 消息 = 当前 prefill”的保守启发式（`normal/regenerate/swipe`；`continue`
  需以 Reasoning Start Tag 开头）。
- **能力判断禁止依赖模型名**：adapter 的能力声明 / provider 检测一律不读模型 id 做匹配；
  reasoning 预填充默认开启，失败靠 Fail Open + Debug 日志兜底。
- reasoning-only（续思考）为实验性：Ollama 原生与 Kimi 官方文档均确认空 content 时行为不保证。
- 纯 content prefill（无 thinking 标签）在 Auto 模式下不做 Provider 翻译（保持原样最安全）。
- 第一版只做 Outgoing 请求翻译；不处理响应解析（Response Adapter 架构预留未实现）。

## 安全

- 本仓库是 SillyTavern 扩展源码，不含密钥。若加入 API Key 相关测试/示例，一律用占位符并走脱敏。
- 不要在 Debug 日志、README、commit message 中放真实密钥。
