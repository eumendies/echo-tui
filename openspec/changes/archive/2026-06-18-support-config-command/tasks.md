## 1. Provider preset 与配置读取

- [x] 1.1 新增 provider preset catalog 模块，定义 OpenAI Responses API、OpenAI Chat Compatible API、Anthropic Compatible API、Xiaomi Mimo Token Plan preset 及 `baseURLMode`、`agentType`、固定 headers/baseURL 扩展字段。
- [x] 1.2 更新 `readLlmConfig()` 的 provider profile 解析逻辑，使用 `preset` 查 catalog 并解析运行时 `agentType`、`apiKey`、`baseURL` 和 headers。
- [x] 1.3 移除用户级旧格式兼容：不再把顶层或 model profile 级 provider 字段作为 fallback，并对缺失/未知 `preset` 给出脱敏错误。
- [x] 1.4 更新 `readLlmModelConfigInfo()` 和 `/model` 所需模型展示信息，使 preset 配置下的模型选择保持可用。
- [x] 1.5 更新 LLM config 单元测试，覆盖三个内置 preset、固定 baseURL/header 展开、未知 preset、缺失 preset、reasoning 只对 Responses preset 生效和旧格式失败。

## 2. 配置编辑与持久化

- [x] 2.1 新增 config editor 模块，读取 `~/.echo/config.json` 为 provider/model 草稿；配置文件缺失时创建空草稿。
- [x] 2.2 实现 provider/model 草稿规范化：生成稳定 provider id 和 model profile id，处理重复 id，并维护 `selectedModel` 指向有效模型。
- [x] 2.3 实现保存前校验，覆盖 provider preset、API key、required Base URL、模型为空、模型 provider 引用和重复 id。
- [x] 2.4 实现配置保存，写入 `llm.providers`、`llm.models`、`llm.selectedModel`，保留 root 和 `llm` 下不冲突的未知配置。
- [x] 2.5 使用临时文件加 rename 原子写入配置，并确保错误消息不会泄漏 API key 或 headers。
- [x] 2.6 新增 config editor 测试，覆盖首次创建、读取已有 preset 配置、保存保留无关配置、取消不写入、校验失败不写入和原子写入路径。

## 3. 配置面板交互

- [x] 3.1 在 `/config` command handler 中实现配置面板状态机，建模列表页、provider 详情页、preset 选择、文本编辑、dirty 状态、错误状态和保存/取消结果。
- [x] 3.2 实现 provider 列表页操作：移动、新增、打开、删除 provider，以及显示 API key 状态和模型数量。
- [x] 3.3 实现 provider 详情页操作：编辑 provider 名称、API key masked 输入、按 preset 展示/编辑/隐藏/固定 Base URL。
- [x] 3.4 实现模型列表操作：新增、编辑、删除模型 API id，并支持设置默认模型。
- [x] 3.5 支持方向键、Enter、Esc、Ctrl+C、Backspace、普通可打印字符和中文字符输入。
- [x] 3.6 新增 footer config surface renderer，仿照 demo 的 cyan 卡片风格渲染列表页、详情页、preset 选择、保存结果、错误提示和键盘帮助。
- [x] 3.7 确保 `/config` 使用主 UI 普通屏幕 redraw，不切换 alternate screen，退出时恢复 raw mode、光标和 ANSI 样式。
- [x] 3.8 新增 command state / footer renderer 测试，覆盖状态迁移、masked secret、Base URL mode、默认模型选择和保存校验错误。
- [x] 3.9 修复 provider preset 切换时同步 preset 名称和建议模型；无建议模型时清空旧模型列表。
- [x] 3.10 修复文本编辑态保存误导：移除 Ctrl+S 保存操作，要求先用 Enter 提交当前编辑字段，再移动到显式保存选项。
- [x] 3.11 新增显式 `save changes` 选项，支持在列表页或详情页按 Enter 保存。
- [x] 3.12 新增显式 `+ add provider` 选项，并移除 `n`/`+` 新增 provider、`a` 新增 model 和 Ctrl+S 保存快捷操作。

## 4. `/config` 集成与文档

- [x] 4.1 更新默认 slash command handler，注册 `/config`，并确保纯 `/config` 命中配置面板、`/config more` 仍作为普通用户消息。
- [x] 4.2 新增 `/config` handler，组合 config editor、内联 command state、config command surface、保存成功结果、保存失败错误和取消关闭行为。
- [x] 4.3 更新 `CommandHost` 和 footer command surface，提供 `config.readDraft()` / `config.saveDraft()` 能力并渲染 `config` surface。
- [x] 4.4 删除独立 `echo-tui config` CLI 子命令，保持 help 不列出 config，并让 `config` 与 `init` 都按 unknown command 处理。
- [x] 4.5 更新 command、app、CLI 测试，覆盖 `/config` 打开、状态更新、保存、保存失败、取消、slash suggestion 和 config CLI unknown 行为。
- [x] 4.6 更新 `docs/README.md` 和架构文档，说明 `/config` 使用方式、provider preset、内置 provider 类型和预定义 provider 扩展方式。

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`。
- [x] 5.2 运行 `npm test`。
- [x] 5.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 5.4 运行 `openspec validate support-config-command` 和 `openspec validate --all`。
- [x] 5.5 手动验证 `/config`：首次创建、选择三类 provider、API key masked 输入、Base URL 行为、模型增删改、默认模型、Esc 取消、显式保存和保存后普通消息能读取新配置。
