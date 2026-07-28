## 1. 配置与共享协议

- [x] 1.1 定义 `FileEditToolMode`、默认值和共享归一化逻辑，将 `tools.fileEdit.mode` 接入 `ToolRuntimeConfig` 与 `AppSettings`，并覆盖缺失、非法和有效值读取测试。
- [x] 1.2 扩展常规设置草稿校验与原子保存，只更新 `tools.fileEdit.mode` 且保留 `tools.bash`、其他 tools 字段和未知根节点，并补充配置读写测试。
- [x] 1.3 在 `/config`“常规”Tab 增加文件编辑工具设置行，调整导航、切换、保存、dirty fingerprint 和 context usage 清理语义，避免继续依赖易错的硬编码行索引，并补充 command/footer 测试。
- [x] 1.4 将 apply-patch 专属 display line/file 类型泛化为可被 `apply_patch` 与 `edit_file` 共用的文件编辑 metadata，扩展 tool execution result 与 transcript details 联合类型，同时保留旧 `kind: apply_patch` 记录兼容性。

## 2. edit_file 工具执行

- [x] 2.1 创建职责聚焦的 `edit_file` handler 与 tool definition，实现 `path`、`old_string`、`new_string`、可选 `replace_all` 参数校验和紧凑调用标签。
- [x] 2.2 复用或抽取受控文本编辑的路径与目标安全检查，覆盖相对/绝对/`..` 路径、`.git` 拒绝、缺失目标、目录/非普通文件、NUL、UTF-8 与文件大小限制。
- [x] 2.3 实现基于调用前原始内容的精确非重叠匹配：唯一替换、零匹配失败、默认多匹配失败、显式 replace-all、空搜索串和 no-op 拒绝，并返回可操作失败提示与实际替换数量。
- [x] 2.4 实现先模拟后写盘及 `ChangeFileRecorder` 集成，确保成功写入捕获 before/after、失败写入不标记 updated，并覆盖真实临时文件与 recorder 测试。
- [x] 2.5 根据 before/post-image 和 match spans 生成 `edit_file` display metadata，正确投影行内、多行、同一行多次和远距离 replace-all 的完整 removed/added/context 行及可信 post-image 行号，并增加纯函数测试。

## 3. Registry、Provider 与审批策略

- [x] 3.1 调整默认 tool registry，使每轮按归一化模式只注册 `apply_patch` 或 `edit_file`，保持其他内置/MCP 工具不变，并覆盖默认、显式选择与非法回退测试。
- [x] 3.2 验证 OpenAI Responses、OpenAI Chat、Anthropic 与 Codex adapter 只转换 registry definitions；增加所选工具 schema 存在、未选工具 schema 不存在及历史另一工具 call/result continuation 测试。
- [x] 3.3 将 `edit_file` 纳入 normal-mode 审批、plan-mode 写入拒绝、headless deny/full-access 和按工具名会话授权；审批 preview 只显示有界路径摘要，并补充 classifier/runtime 测试。

## 4. 共享文件编辑 Renderer

- [x] 4.1 将现有 apply-patch 结果行构造、metadata 校验、上下文折叠、修改区块预算和 ANSI 行渲染抽成共享 file-edit renderer，保持 apply-patch 现有可见行为与旧 metadata 兼容。
- [x] 4.2 在 tool message 路由中增加 `edit_file` 调用摘要和成功结果专属投影；合法 metadata 使用共享 diff renderer，失败或非法 metadata 安全降级且不读取目标文件。
- [x] 4.3 增加 `edit_file` renderer 测试，覆盖完整旧/新行、路径与增删统计、多个远距离修改区块、同一行多次替换、上下文折叠、长行换行背景、软预算、自定义主题和窄终端安全宽度。
- [x] 4.4 增加 session round-trip/resume 测试，验证 `edit_file` metadata 持久化后可直接重绘，并验证历史 `apply_patch` metadata 无需迁移仍可使用共享 renderer。

## 5. Change history、Diff 与 Undo

- [x] 5.1 将非 Git `/diff` fallback 的 source label、notice、注释与默认空状态从 `apply_patch history` 泛化为受控文件编辑历史，并更新 command/footer/diff-source 测试。
- [x] 5.2 增加 `edit_file` 成功、校验失败、写盘失败和同一 loop 多次受控编辑的 checkpoint 测试，验证 `/undo` 只恢复真实成功修改且保留第一次 before snapshot。
- [x] 5.3 增加跨进程 session persistence 测试，验证 `/resume` 后 `/diff` 与 `/undo` 可以消费包含 `edit_file` 更新的既有 change history。

## 6. 回归验证与文档同步

- [x] 6.1 更新受影响的默认工具列表、配置示例和架构说明，明确 `edit_file` 第一版只更新已有文件、精确匹配规则、replace-all 风险及下一轮生效语义。
- [x] 6.2 运行 `npm run typecheck` 并修复全部类型错误。
- [x] 6.3 运行 `npm test` 并修复全部自动化测试回归。
- [x] 6.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 并确认 JavaScript 语法检查通过。
- [x] 6.5 整理供用户执行的交互验证清单，覆盖 `/config` 模式切换、下一轮 tool schema、生效后的审批/plan/headless 行为、diff-style transcript 投影、`/diff`、`/undo`、`/resume` 和 Esc/退出清理。
