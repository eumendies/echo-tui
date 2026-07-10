## 1. 建立统一的 slash runtime 契约

- [x] 1.1 新增统一的 slash resolver 与 handler 接口，实现按 handler 顺序 `match()` 的方案 B 路由，并将现有 `/help` 迁移为基于 handler 的命令实现。
- [x] 1.2 定义结构化 command effect 与 effect interpreter 所需的最小动作集合，确保命令通过 effect 请求“打开/更新/关闭 session、追加 transcript、更新会话配置”等动作，而不是直接改 app 状态。

## 2. 接入 app 状态机与渲染 surface

- [x] 2.1 更新 `src/app/main.js`，引入显式的 `activeCommandSession` 与统一的 slash 提交/事件分发路径，让活跃命令会话优先处理后续输入事件。
- [x] 2.2 更新 footer / app renderer 相关逻辑，使 renderer 读取统一的 command surface kind（如 `info` / `select` / `confirm`），而不是读取某个具体命令的私有 overlay 结构；同时保持现有 `/help` 用户可见行为不回退。

## 3. 补充测试与验证

- [x] 3.1 更新 slash、app 与 render 测试，覆盖 resolver 路由、handler 匹配、effect interpreter、active command session 事件分发，以及 `/help` 在新运行时下的行为回归。
- [x] 3.2 运行 `npm test` 与 `find bin src test -name '*.js' -exec node --check {} \;`，确认 slash runtime 重构后的行为与语法检查全部通过。
