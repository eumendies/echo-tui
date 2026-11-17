## Why

`SYSTEM.md` 的读取能力早已就绪（`src/agent/context/system-prompt.ts` 的 `loadSystemPromptOverride`，项目级优先于 `~/.echo/SYSTEM.md`），但没有任何 UI 入口。用户想改基础 system prompt 只能自己知道文件名、自己找项目根、自己判断哪一份生效，改完也不知道是否被采纳。README 里只有一句“可创建 SYSTEM.md”，实际使用中很容易写到错误位置或被另一份文件遮蔽而无从察觉。

把这件事收进 `/config`：用户能看见当前生效来源、两份文件的实际路径与行数、就地编辑并原子落盘，而不必离开 TUI。

## What Changes

- 配置中心“常规”Tab 在“项目指令文件”行之后新增只读摘要行“系统提示词”，值为 `项目 SYSTEM.md`、`全局 SYSTEM.md` 或 `内置默认`；Enter 进入管理视图。该行不参与常规草稿、不参与 dirty 判定，也不展示文件体积。
- 管理视图为按钮列表：查看当前生效的 system prompt、编辑项目 SYSTEM.md、编辑全局 SYSTEM.md、删除项目 SYSTEM.md、删除全局 SYSTEM.md、返回常规设置。使用方向键 + Enter，不提供 `e`/`g`/`r` 之类字母快捷键。
- 状态区展示当前生效来源、两个目标的绝对路径 / 存在性 / 行数；不展示字节数。另附动态段摘要（Runtime environment、AGENTS.md、Skills、Memory 的来源与估算 token），并明确标注这些段由运行时拼装、不可编辑。
- “查看当前生效”打开只读阅读态：标题标明来源，正文按终端宽度折行并带行号，长行不截断；Up/Down 逐行、PageUp/PageDown 翻页；不拼接动态段。
- “编辑项目 / 编辑全局”是两个完全独立的入口，不再提供写入目标切换开关。编辑态预填目标文件内容，文件不存在时预填内置默认文本，等价于新建；草稿同样按终端宽度折行并保持光标位置正确。Enter 进入保存确认（显示路径与是否覆盖），Ctrl+J 换行，Esc 丢弃草稿。
- 写入口径与运行时 loader 同源：CRLF/CR 归一为 LF、去除首尾空白、父目录递归创建、同目录临时文件 + rename 原子替换。归一化后与现有文件逐字相同则不写盘并提示“内容未变化”；归一化后为空则拒绝保存并提示改用删除。
- “删除项目 / 删除全局”删除对应 `SYSTEM.md` 本身，确认框标明删除后的回落目标（另一目标或内置默认）；文件不存在时该行灰显，Enter 只给提示不写盘。
- 保存或删除成功后重新读取快照、回到按钮列表、提示“下一轮 assistant run 生效”，并使已缓存的 context usage 失效。
- 无 BREAKING：system prompt 的加载优先级、只替换基础文本、run 内冻结、子 Agent 继承与 headless `--once` 读取同一份文件等既有语义全部保持不变。

## Capabilities

### New Capabilities

- `config-system-prompt`: 定义 `/config` 常规 Tab 的系统提示词入口、两目标文件快照与生效来源解析、按钮式管理视图、只读阅读态、编辑与原子写入、删除与回落、动态段摘要、交互层级以及失败处理。

### Modified Capabilities

无。

`streaming-llm-service-adapter` 已有的“内置 system prompt 注入”要求（优先级、只替换基础文本、动态段继续追加）本次不改，新能力规格里专门写了一条“运行期语义保持不变”来锁死它。`config-surface-settings` 的 Tab 框架、分域保存与 dirty 语义也不变：新视图自己声明复用同一 command session、不进入 `discardConfirm` 统计，属于纯增量行为。

## Impact

- 新增：`src/types/command/system-prompt-surface.ts`、`src/app/command/system-prompt-command-port.ts`、`src/render/footer/system-prompt-surface.ts`。
- 修改：`src/agent/context/system-prompt.ts`（新增文件快照、原子写入、删除）、`src/types/command/config-surface.ts`（新增 `systemPrompt` view）、`src/types/command/host.ts`（config 端口三个方法）、`src/app/command/command-host.ts`（端口装配）、`src/commands/config/state.ts`（行集合与初始态）、`src/commands/config/handler.ts`（模式分发与 Esc/Tab 层级）、`src/render/footer/config-surface.ts`（常规行文案与新视图接入）。
- 测试：新增 `test/commands/system-prompt-command-handler.test.js`、`test/render/system-prompt-surface.test.js`，扩展 `test/agent/system-prompt.test.js`，同步 `test/render/config-surface.test.js` 的常规行断言。
- 文档：`README.md`、`docs/configuration.md`、`docs/tui-architecture.md`。
- 不影响：`~/.echo/config.json` 结构与写入、transcript journal、session index、MCP 与 tool approval 流程、`echo-tui --once` 的既有行为。
