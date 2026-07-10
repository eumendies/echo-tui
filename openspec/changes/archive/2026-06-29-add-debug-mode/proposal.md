## Why

开发者现在缺少一个内建、低干扰的流程调试入口，只能依赖临时打印或外部 hooks 来观察 assistant turn、工具执行、压缩和 provider 请求构造等关键流程。需要提供一个仅面向开发启动路径的 debug 模式，帮助定位流程问题，同时不改变普通用户通过 `echo-tui` 启动时的体验。

## What Changes

- 新增开发者 debug 模式：启用后将关键运行时流程事件写入结构化日志文件。
- 新增 `npm start:debug` 脚本，用于构建后以 debug 模式启动 TUI。
- 保持 `npm start` 不启用 debug 模式，继续作为普通本地启动路径。
- debug 模式只显示一个短提示说明已启用及日志位置，不改动现有渲染布局、footer 逻辑或 transcript 语义。
- debug 日志作为旁路观察数据，不写入 transcript，不进入 provider 请求，不影响 tool approval、tool execution、compaction 或 session persistence。

## Capabilities

### New Capabilities
- `developer-debug-logging`: 描述开发者 debug 模式的启用方式、结构化日志、提示展示、旁路隔离和敏感信息保护要求。

### Modified Capabilities
- `typescript-build-test-pipeline`: 增加开发启动脚本契约，要求 `npm start` 保持非 debug，`npm start:debug` 才启用 debug 模式。

## Impact

- 影响 `package.json` scripts：新增 `start:debug`，并确保 `start` 不设置 debug 环境。
- 影响 CLI/app 装配入口：需要读取开发者 debug 环境开关并创建 debug 日志上下文。
- 影响 assistant turn、agent loop、工具执行、压缩和 provider 请求构造边界：需要在关键时点发出结构化 debug 事件。
- 影响测试：需要覆盖 debug 开关解析、`npm start`/`npm start:debug` 脚本契约、debug 日志旁路写入和非 debug 默认行为。
