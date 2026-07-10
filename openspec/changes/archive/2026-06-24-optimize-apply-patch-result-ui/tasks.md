## 1. 扩展 apply-patch 展示数据

- [x] 1.1 定义 `ApplyPatchDisplayFile` 和展示行的必填事实结构
- [x] 1.2 调整 update hunk 的内存模拟流程，在精确唯一匹配成功后按实际 match index 生成 display metadata，不使用 patch header 行号
- [x] 1.3 为成功定位的 update file 生成完整、有序且不重复的 post-image context/added 行
- [x] 1.4 为新增文件生成从第 1 行开始推进的展示位置，并为匹配失败、写入失败和解析失败保留各自正确的 metadata 降级语义
- [x] 1.5 更新 apply-patch 工具执行测试，覆盖 added 占用行号、removed 不占用行号、多 hunk 位移、上下文边界、窗口合并和失败时不伪造位置

## 2. 构建结构化 patch 投影

- [x] 2.1 在 tool message renderer 中将 display metadata 投影为文件标题、`+N -N` 统计、修改窗口和逻辑 diff rows
- [x] 2.2 实现单列右对齐定位 gutter：context 显示真实 post-image 行号，added/removed 在同一列显示 `+`/`-`，wrapped continuation 留空
- [x] 2.3 实现未修改上下文折叠，保留修改前后各 3 行并使用带隐藏逻辑行数的中性省略 marker
- [x] 2.4 实现结构化总预算分配，保留所有文件标题及每个修改区块，优先省略 context 并避免只截断尾部

## 3. 完成终端样式与严格 schema 路由

- [x] 3.1 将 added/removed 背景从定位 gutter 铺满至 `safeRenderWidth`，保持外层工具前缀中性，并正确处理中文、emoji 和 ANSI 显示宽度
- [x] 3.2 让长增删行的每个 wrapped physical row 保持相同整行背景，且 continuation 不重复推进逻辑行号
- [x] 3.3 保留失败原因展示、成功摘要隐藏和解析失败无 metadata 时的通用渲染
- [x] 3.4 更新 renderer 测试，覆盖文件分组、统计、单列 gutter、整行背景、窄终端换行、折叠、多文件公平截断、失败结果和历史恢复

## 4. 文档与验证

- [x] 4.1 更新 `docs/tui-architecture.md` 中 apply-patch display metadata 和 tool message rendering 的架构说明
- [x] 4.2 运行 `npm run typecheck`
- [x] 4.3 运行 `npm test`
- [x] 4.4 运行 `find bin src test -name '*.js' -exec node --check {} \;`
- [x] 4.5 使用 `npm start` 手动验证成功/失败 patch、多文件、多 hunk、长行、窄终端、resize 和 `/resume` 的显示行为

## 5. 收敛 metadata 与折叠职责

- [x] 5.1 删除 apply-patch metadata 的 `schemaVersion`、hunk location 和 omittedBefore/omittedAfter 字段
- [x] 5.2 让 handler 为成功 update 返回完整 post-image 文件行，并在对应位置插入 removed 行
- [x] 5.3 让 renderer 从完整行序列识别修改区块并独立生成、合并 omitted rows
- [x] 5.4 增加连续大段 context 和多修改区块测试，断言不会输出连续 unchanged-lines markers
- [x] 5.5 更新架构文档并重新运行 typecheck、全量测试和 JS syntax check

## 6. 修复最低结构预算溢出

- [x] 6.1 将 apply-patch 行数预算改为软预算，移除最终无语义尾部切片
- [x] 6.2 增加最低结构超过 120 行的回归测试，确认最后文件和最后修改区块仍可见

## 7. 清理 metadata 与预算计算

- [x] 7.1 保留后续 hunk 删除先前 added 行时清除 added 标记的逻辑，并增加回归测试
- [x] 7.2 仅在折叠投影超过软预算时计算修改区块分组

## 8. 收敛 apply-patch 模块职责

- [x] 8.1 将单文件 handler 拆为公共入口、工具编排、语法解析和内存模拟四个模块
- [x] 8.2 保持现有公共导入路径、执行语义和 display metadata 行为不变
- [x] 8.3 更新架构文档并重新运行完整验证

## 9. 收敛 tool message renderer 职责

- [x] 9.1 保留顶层 renderer 公共入口，将 apply-patch、bash 和共享终端渲染逻辑移入子目录
- [x] 9.2 保持 tool call/result 路由、通用 fallback 和现有可见投影行为不变
- [x] 9.3 更新架构文档并重新运行完整验证
- [x] 9.4 使用复数目录名 `tool-message-renderers/`，避免与顶层入口文件同名
