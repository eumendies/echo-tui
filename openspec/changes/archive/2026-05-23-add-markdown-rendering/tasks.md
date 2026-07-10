## 1. Markdown 投影基础

- [x] 1.1 新增 `src/render/markdown.ts`，实现按行扫描的 tolerant Markdown subset parser，覆盖 paragraph、heading、list、blockquote、horizontal rule 和 fenced code block。
- [x] 1.2 为 Markdown 投影建立可测试的内部行/span 模型，确保 wrap 计算基于可见文本宽度，ANSI 样式只在输出阶段应用。
- [x] 1.3 实现代码块直接高亮显示：不画边框、卡片或语言标签，保留原始缩进，不解析代码块内部 inline Markdown。
- [x] 1.4 实现 inline code、bold、italic 和 link 的克制 ANSI 投影，并保证样式闭合不污染后续行。

## 2. 接入 assistant 与 pending 渲染

- [x] 2.1 修改 `src/render/blocks.ts`，让 completed assistant transcript block 使用 Markdown-aware terminal projection，同时保持 `◆` 前缀和 block spacing。
- [x] 2.2 修改 streaming pending preview 路径，让 `◇` pending 内容使用容错 Markdown projection，并继续支持长 preview 头部折叠与尾部保留。
- [x] 2.3 确保 user message 和 error message 仍按现有纯文本语义渲染，不被 Markdown parser 处理。
- [x] 2.4 若现有 ANSI helper 不足，补充最小语义样式 helper，避免在业务渲染代码中散落裸 escape code。

## 3. 测试覆盖

- [x] 3.1 新增 Markdown renderer 单元测试，覆盖 heading、paragraph wrap、无序/有序列表续行对齐、blockquote 和 horizontal rule。
- [x] 3.2 新增代码块测试，覆盖不画框、不显示语言标签、直接高亮、保留缩进、代码块内部不解析 inline Markdown、未闭合 fenced code block 容错。
- [x] 3.3 新增 inline 样式测试，覆盖 inline code、bold、italic、link、中文宽字符和 ANSI 不影响 display width。
- [x] 3.4 更新 assistant block 和 pending footer 测试，验证 Markdown projection、terminal rows 高度预算、折叠摘要和最终 transcript 原文不变。

## 4. 文档与验证

- [x] 4.1 更新 `docs/README.md` 和 `docs/tui-architecture.md`，说明 Markdown 支持范围、非目标、代码块直接高亮策略和手工验证方式。
- [x] 4.2 运行 `npm run build`、`npm run typecheck`、`npm test`、JS syntax check 和 OpenSpec strict validate。
- [x] 4.3 使用 `npm start` 做轻量手工验证：普通 Markdown 回复、长代码块、resize 后 replay、streaming preview 折叠行为均正常。
