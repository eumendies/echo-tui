## 1. 审批设置与配置读写

- [x] 1.1 定义独立的 `ToolApprovalMode` 和审批设置类型，在 `AppSettings` 中加入 mode 与可选 model profile id，并为新增结构字段补充中文领域注释。
- [x] 1.2 扩展 app settings 归一化、严格草稿校验和原子保存逻辑，缺失或非法 mode 回退 manual，保存时增量维护 `tools.approval` 并保留其他配置节点。
- [x] 1.3 为 auto 草稿增加严格 model profile 引用校验，确保缺失、陈旧或不存在的 profile 阻止保存，manual 保存可保留已有 profile id。
- [x] 1.4 更新 AppContext 配置缓存与 watcher 刷新结果，使审批设置按 assistant turn 快照并只影响下一回合，不触发无关 transcript 重绘。
- [x] 1.5 扩展 app settings 单元测试，覆盖默认 manual、字段独立回退、auto profile 校验、节点保留和原子写入。

## 2. `/config` 动态审批设置界面

- [x] 2.1 将常规设置固定 row ids 重构为 handler 与 renderer 共用的动态行投影，始终包含审批模式并仅在 auto 草稿下插入审批模型行。
- [x] 2.2 扩展 General config state 和 command config port，为审批模型行提供已保存 model profiles 的非敏感候选及当前选择。
- [x] 2.3 实现 manual/auto 调整、审批模型循环选择、模式切换后的 selected index 归一化和无候选时的不可用状态。
- [x] 2.4 扩展常规配置 surface 渲染与保存反馈，明确区分工具审批模式和默认 interaction mode，并在 auto 缺少有效模型时显示可理解错误。
- [x] 2.5 更新 config command 与 renderer 测试，覆盖 manual 隐藏、auto 显示、动态焦点、模型切换、dirty fingerprint 和保存校验。

## 3. 自动审批 Reviewer

- [x] 3.1 从 agent setup 提取可复用的 provider agent 工厂，使审批 reviewer 能用指定 `LlmConfig` 且不装配 `ToolRegistry` 创建现有 provider adapter，不暴露默认工具或 MCP。
- [x] 3.2 实现严格审批 model profile 解析，禁止无效 profile 静默回退 selected/session model，并从审批运行配置移除 reasoning summary、将 reasoning effort 设为 `none`。
- [x] 3.3 实现最近 10 条审批上下文投影，按顺序保留 user、assistant、进入上下文的 shell、tool call 和 tool result 文本，过滤本地/provider-private records，并单独追加当前 tool name 与原始 arguments。
- [x] 3.4 实现固定 yes/no prompt 和严格响应解析，仅将去除首尾空白并忽略大小写后精确等于 `yes` 的文本判为允许，其余文本判为 no。
- [x] 3.5 实现 reviewer 请求执行、abort 传播以及配置/provider/解析失败到 no 的 fail-closed 映射；审批 prompt、响应和 provider-private records 不进入主 transcript。
- [x] 3.6 接入现有 usage/debug 旁路：有 provider usage 时按现有账本规则记录，debug 只记录模型、tool name、结果和参数 hash 等非敏感摘要。
- [x] 3.7 增加 reviewer 单元测试，覆盖记录筛选和顺序、当前 call 投影、严格 yes/no、profile 失效、无工具 agent、各 adapter 在 effort `none` 时无 reasoning 请求、provider 失败和 abort。

## 4. 交互式审批编排

- [x] 4.1 重构 `ToolApprovalContext`，显式区分 session 缓存查询与创建人工审批请求，并保持 active modal、四个基础操作及动态 tool/command 会话授权选项的现有行为。
- [x] 4.2 在 assistant turn 装配审批设置快照和 reviewer，将 manual 路径直接接回现有人工审批，将 auto 路径插入缓存未命中的 approval-required callback。
- [x] 4.3 将 auto 精确 yes 映射为现有 `allow_once` 且不写入 session cache，将 no 或 fail-closed 结果接回同一个人工 permission surface。
- [x] 4.4 确认所有现有 approval-required 类型统一经过该编排，包括 `apply_patch`、`edit_file`、高风险 bash 和需要审批的 MCP tool；safe 与 rejected 调用不得触发 reviewer。
- [x] 4.5 保持 headless deny/full-access、plan/readonly 拒绝、tool result continuation 和 lifecycle hook 语义不变，并确保 turn abort 期间不会打开迟到的审批 surface。
- [x] 4.6 扩展 ToolApprovalContext、assistant turn 和 agent loop/controller 测试，覆盖缓存优先、manual 不调用 reviewer、auto yes、auto no、非法输出、provider 失败、用户中断及 late callback 隔离。
- [x] 4.7 增加高风险 bash 与 MCP 集成测试，验证 auto yes 执行一次、auto no 回退现有 preview/选项，以及 `approval: "never"` MCP tool 跳过自动和人工审批。

## 5. 文档与验证

- [x] 5.1 更新用户配置说明和内置 `echo-tui-setup` skill，记录 `tools.approval.mode`、`modelProfileId`、manual 默认值、严格 yes/no 与失败回退语义。
- [x] 5.2 更新相关架构文档，说明 auto approval 与 interaction mode、headless approval policy、session grants 的边界。
- [x] 5.3 运行 `npm run typecheck`，修复全部类型错误。
- [x] 5.4 运行 `npm test`，确保新增和既有测试全部通过。
- [x] 5.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`，确认 JavaScript 文件语法检查通过。
- [x] 5.6 整理交付给用户的 TUI 手动验证清单，覆盖 `/config` 动态行、manual/auto、auto yes/no/失败回退、现有审批操作和 Esc 中断。
