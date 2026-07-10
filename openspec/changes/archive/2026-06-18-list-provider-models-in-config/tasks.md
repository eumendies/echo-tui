## 1. Provider 模型枚举能力

- [x] 1.1 在 provider model listing 模块集中维护 agent type 到模型枚举协议的映射，覆盖 OpenAI Responses、OpenAI Chat Compatible、Anthropic Compatible 和 Xiaomi Mimo Token Plan 的初始行为。
- [x] 1.2 新增 provider-neutral 模型枚举模块，基于 provider 草稿解析 preset、API key、Base URL 和 headers，并返回最小 `{id}` 模型列表。
- [x] 1.3 使用 OpenAI SDK 实现 OpenAI-compatible models listing，覆盖 fixed Base URL、default headers、空列表和请求失败。
- [x] 1.4 使用 Anthropic SDK 实现 Anthropic-compatible models listing，覆盖 SDK 返回结构、空列表和请求失败。
- [x] 1.5 统一模型枚举错误脱敏，确保 API key、Bearer token、Authorization、x-api-key 和隐藏 headers 不进入 UI 错误文本。

## 2. Command runtime 与 host 集成

- [x] 2.1 扩展 `CommandHostApp.config`，新增 `listModels(providerDraft)` 能力，并在 app command host 中连接模型枚举模块。
- [x] 2.2 更新 command runtime，使异步 command handler 完成 session update 后能再次触发 footer redraw。
- [x] 2.3 增加 late callback 隔离，模型枚举请求完成时若 `/config` session 已关闭或切换，则不得更新当前 surface。
- [x] 2.4 为异步 command runtime 行为新增测试，覆盖 loading 后异步结果自动重绘。

## 3. `/config` 状态机与交互

- [x] 3.1 扩展 config command 类型，新增 `listModels` form row、model list mode、loading/result/error state 和远端模型结果结构。
- [x] 3.2 在 provider 详情页 `+ add model` 下方插入显式 `list models` 选项，Enter 激活模型枚举。
- [x] 3.3 实现激活前校验：API key 必须已提交，required Base URL 必须有效；校验失败只显示面板错误，不发起请求。
- [x] 3.4 实现模型枚举 loading、success、empty、unsupported 和 error 状态迁移。
- [x] 3.5 实现远端模型选择：新增不存在的模型，已存在时聚焦已有模型，不重复添加。
- [x] 3.6 保持 `list models` 只修改 command session 草稿，不写配置；Esc 取消后不得影响 `~/.echo/config.json`。

## 4. Footer 渲染与文档

- [x] 4.1 更新 footer config surface，渲染 `list models` action row、模型枚举 loading、远端模型列表、空列表、unsupported 和错误提示。
- [x] 4.2 更新键盘帮助文案，说明 provider 详情页支持 Enter list/select、Esc back、手动 `+ add model` 仍可用。
- [x] 4.3 更新 `docs/README.md` 和架构文档，说明 `/config` 可从 provider models API 拉取模型且不会自动保存。

## 5. 测试与验证

- [x] 5.1 更新 config command handler 测试，覆盖 list models 行位置、loading、成功添加、重复模型聚焦、unsupported、失败脱敏和取消不保存。
- [x] 5.2 更新 provider model listing 测试，覆盖 OpenAI-compatible、Anthropic-compatible、fixed Base URL、headers 合并和错误脱敏。
- [x] 5.3 更新 footer config surface 测试，覆盖远端模型列表和窄屏渲染。
- [x] 5.4 运行 `npm run typecheck`。
- [x] 5.5 运行 `npm test`。
- [x] 5.6 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 5.7 运行 `openspec validate list-provider-models-in-config` 和 `openspec validate --all`。
