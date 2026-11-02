## Why

`/resume` 当前会重新排版并输出 compaction 后的全部活跃历史，大上下文窗口下仍会造成明显的排版和终端输出开销。对本项目四份真实会话的临时测量表明，约 1,000 行的尾部投影可将排版中位数从 31–215ms 降至 4–6ms，并减少约 80%–98% 的 ANSI 输出量，适合先作为独立、用户可控的显示优化。

## What Changes

- 为主会话的历史破坏性重绘增加独立行数预算，默认 1,000 行；恢复、resize、主题/显示偏好变化及返回主会话视图使用同一规则。
- 在 `/config → 常规` 增加“历史重绘预算”，可选 500、1,000、2,000、5,000、10,000 行或“不限”，持久化到 `ui.historyRenderLineLimit`；`0` 表示不限。
- 按既有可见性和完整渲染块语义，从最新块向前按需排版，达到预算后停止较早块的昂贵排版；不采用全量渲染再裁剪。
- 行数为软预算：包含达到预算的完整边界块，不切断工具对、子 Agent 分组或消息正文。单块超长时允许超过预算，本次不增加块内折叠。
- 省略历史时显示瞬时说明，明确完整记录和模型上下文不受影响，指引用户到 `/config` 调大预算或选择不限；不新增 transcript record。
- 默认重绘展示从全部活跃记录变为近期后缀；不限档位恢复旧的活跃历史展示范围，但不会越过 compaction 边界重载已压缩原文。
- 不增加内存/磁盘渲染缓存、历史分页、异步重放、存储 checkpoint 或新的历史查看命令；不改变 BTW、子 Agent 独立视图及 `/resume` 列表预览的展示范围。

## Capabilities

### New Capabilities

- `history-render-budget`: 主会话历史的行数软预算、按块尾部选择、瞬时省略提示及显示与会话事实的隔离。

### Modified Capabilities

- `config-surface-settings`: 增加历史预算的配置档位、草稿/保存/归一化和即时刷新规则，并明确 reasoning 显示偏好与预算共同决定历史投影。
- `terminal-tui-prototype`: 将主会话恢复和破坏性重绘中的“完整快照”明确为预算内历史与完整实时/footer 状态的组合，更新压缩与无压缩会话及各 role 的重绘约定。

## Impact

- 配置：`src/config/app-settings-config.ts`、实例配置 snapshot、`src/commands/config/` 和 `src/render/footer/config-surface.ts`。
- 编排：`src/app/state/app-context.ts`、配置刷新链路和 `src/app/render-coordinator.ts` 的主会话 owner 边界。
- 渲染：`src/render/transcript-renderer.ts` 的分组与按需排版、`src/render/app-renderer.ts` 的历史拼接及相关 render types。
- 测试：配置读写/命令交互、投影选择/分组、压缩恢复、流式恢复、owner 隔离及渲染预算的性能结构断言。
- 文档：用户配置字段、默认历史范围变化、软预算例外和“不限”的性能成本。
- 不新增依赖，不改变 journal schema、provider 输入、compaction、Undo、fork/copy/reference 或 headless 输出语义；不切换 alternate screen。
