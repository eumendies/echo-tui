## 1. 行为刻画

- [x] 1.1 增加失败复现测试，覆盖 Begin Patch update 中 context-only chunk 锚定后续插入的用户样例。
- [x] 1.2 增加 `@@ <context>` inline anchor 插入测试，验证新增内容插入到锚点行之后。
- [x] 1.3 增加拒绝测试，覆盖无锚点纯插入、只有 context-only chunk、锚点匹配 0 次和锚点匹配多次。

## 2. Parser 更新

- [x] 2.1 扩展 Begin Patch update chunk 内部表示，记录是否包含真实改动以及可选 inline anchor。
- [x] 2.2 调整 Begin Patch hunk 解析，允许 context-only chunk 通过解析但不把整段无修改 update 视为有效修改。
- [x] 2.3 保持 unified diff parser 现有行为不变，避免把顺序 chunk 语义扩散到 unified diff。

## 3. Simulator 更新

- [x] 3.1 为 Begin Patch update 实现顺序定位游标，context-only chunk 匹配成功后推进后续搜索范围。
- [x] 3.2 实现 `@@ <context>` 单行锚点应用规则，支持锚点后插入和锚点后继续匹配修改 chunk。
- [x] 3.3 保留安全拒绝语义：无上下文纯插入不猜测位置，任一 chunk 匹配失败或歧义时不写入任何文件。
- [x] 3.4 校准 display metadata 生成，确保成功 patch 的 added/removed 行基于实际应用位置，context-only anchor 不被渲染成修改。

## 4. 验证

- [x] 4.1 补充或更新 `test/tools/tool-execution.test.js` 中的 display metadata 断言，覆盖顺序锚定后的真实 postLine。
- [x] 4.2 运行 `npm run typecheck`。
- [x] 4.3 运行 `npm test`。
- [x] 4.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
