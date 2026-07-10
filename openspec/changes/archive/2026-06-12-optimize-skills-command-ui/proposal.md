## Why

当前 skill 管理入口拆成 `/skills list` 和 `/skills manage`，但 manage 面板已经覆盖 list 的核心价值：展示所有 discovered skills、来源、描述和启用状态，同时还能直接启停。保留两个子命令增加了用户记忆成本，也让 `/skills` 的默认行为不够直接。

新的 `/skills` 应成为唯一的 skill 管理入口，并以更清晰的终端卡片 UI 呈现启用计数、开关状态和当前选中项。

## What Changes

- **BREAKING** 移除 `/skills list` 和 `/skills manage` 作为本地 slash command 的行为；本地命令只匹配纯 `/skills`。
- `/skills` 直接打开 skill manager 面板，展示所有有效 discovered skills，并允许启停 skill。
- skill manager 面板仿照外部 demo `terminal_skills_manager.py` 的 cyan card 视觉：标题、enabled 计数、on/off pill、当前行 accent、高亮背景、底部快捷键提示。
- 不引入 demo 中的搜索框或搜索交互；第一版继续使用现有 key handling：Up/Down 移动、Space 切换、Enter 保存、Esc 取消。
- 保存后继续刷新 enabled skill catalog、slash suggestion 和 direct skill invocation 行为；取消时不写入状态文件。
- disabled skill 的提示文本改为引导用户使用 `/skills` 启用。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `skill-system`: 将 skill 管理 slash command 从 list/manage 子命令改为单一 `/skills` 管理入口，并更新禁用提示与 suggestion 刷新要求。
- `terminal-tui-prototype`: 增加专用 skills command surface 的终端渲染行为要求，覆盖新的 card-style manager UI。
- `streaming-llm-service-adapter`: 将 provider skill catalog 刷新场景中的状态保存入口从 `/skills manage` 更新为 `/skills`。
- `command-host-runtime`: 将 CommandHost skill 管理能力场景中的命令入口从 `/skills list`/`/skills manage` 更新为 `/skills`。
- `local-tool-execution`: 将 `use_skill` disabled skill 失败提示中的启用入口从 `/skills manage` 更新为 `/skills`。

## Impact

- 影响 slash command handler：`src/commands/skills-command-handler.ts`。
- 影响 command surface 类型与 footer 渲染：`src/types/command.ts`、`src/render/footer/command-surfaces.ts`，以及新的 skills surface renderer。
- 影响 skill manager 禁用提示：`src/skills/skill-manager.ts` 或其调用路径。
- 影响 provider skill catalog 相关文档和测试中对保存入口的引用。
- 影响 docs 和 OpenSpec 主规格中 `/skills list`、`/skills manage` 的描述。
- 影响测试：slash command 行为、app integration、footer rendering、disabled skill 提示和 docs/spec 相关断言。
