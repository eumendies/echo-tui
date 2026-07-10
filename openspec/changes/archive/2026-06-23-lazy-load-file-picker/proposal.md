## Why

当前 `@` file picker 打开时会一次性通过 `rg --files` 扫描 cwd 下全部文件路径；在 `/Users/example/projects` 这类大目录中，`spawnSync` 输出超过 1MB buffer 后触发 `ENOBUFS`，导致 picker 显示为空。需要改为目录级懒加载，避免大目录因为全量扫描而无法展示第一层文件和子目录。

## What Changes

- file picker 打开时只加载当前 cwd 的直接子文件和子目录，不再一次性扫描完整目录树。
- 用户进入子目录时按需加载该子目录的直接子项；返回父目录时复用或重新加载父目录子项。
- 文件过滤 query 保持可用，但必须避免同步生成无限或超大 stdout；搜索结果需要有数量上限和稳定排序。
- 文件 preview、Space 多选、Enter 插入 mention、Esc 取消、footer 布局、resize 重绘和 provider-facing 文件上下文语义保持不变。
- 当目录不可读或读取失败时，file picker 应显示可见说明，而不是静默空白。

## Capabilities

### New Capabilities
- 无。

### Modified Capabilities
- `composer-file-picker-context`: file picker 的浏览数据来源从打开时全量扫描改为目录级懒加载，并要求大目录下仍能展示直接子项。
- `terminal-tui-prototype`: `@` 文件选择器 transient footer surface 在大目录和读取失败场景下仍需可重绘、可交互，并提供明确反馈。

## Impact

- 主要影响 `src/app/state/file-picker-context.ts` 的文件发现、目录进入/返回、query 过滤和 surface 状态派生。
- 可能需要调整 `src/render/footer/file-picker-surface.ts` 的空状态或 notice 呈现，但不改变整体两栏布局。
- 需要更新 `test/app/file-picker-context.test.js` 和相关 footer renderer 测试，覆盖大目录、懒加载、目录读取失败和 query 行为。
- 不引入第三方 TUI 库，不改变 composer mention 格式、提交时文件上下文注入、provider adapter 或 transcript 持久化语义。
