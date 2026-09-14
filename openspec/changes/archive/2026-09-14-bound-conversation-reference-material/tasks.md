## 1. 类型与素材结构调整

- [x] 1.1 在 `src/types/transcript.ts` 将 `PendingConversationReference` 的素材字段从整段 `materialText` 字符串改为按记录粒度的结构化记录段数组（每段含区块头与正文），并为新增字段补充中文注释
- [x] 1.2 适配 `src/app/command/conversation-reference-command-port.ts` 与 `src/app/composer-submission-controller.ts` 的类型引用与传参，保持提交生命周期行为不变

## 2. 素材源改为源会话活跃投影

- [x] 2.1 在 `src/agent/context/conversation-reference.ts` 让 `createPendingConversationReference` 感知 `session.compaction`：存在 compaction 时先渲染 `[compacted_summary]` 区块（内容为 `compaction.summaryText`），再渲染 `records.slice(activeStartIndex)`；无 compaction 时保持全部最终 records
- [x] 2.2 反转 `test/agent/conversation-reference.test.js` 中「不拼接 compaction summary」的两处断言，改为断言 summaryText 进素材、`activeStartIndex` 之前 records 不进、未压缩会话保持全量

## 3. 总结输入上限与头尾截断降级

- [x] 3.1 新增并导出总结输入上限函数 `min(64000, floor(contextWindow * 0.5))`，使用现有 `estimateTextTokens` 估算素材与段落 token
- [x] 3.2 在发送阶段实现三级判定：素材 ≤ 引用预算 → full 零请求；≤ 总结输入上限 → 单次总结；> 总结输入上限 → 先截断再单次总结，且预算与上限按本轮生效模型 contextWindow 重算
- [x] 3.3 实现头尾保留截断：compacted_summary 区块优先保留（其自身超限则对 summaryText 截断并标注），随后从头部保留最早若干条、从尾部保留最近若干条逐段累加至接近上限，中段以 `[已省略 N 条记录]` 伪段替代，保证截断后输入不超上限且只发起一次摘要请求

## 4. 截断场景的回读提示

- [x] 4.1 发生头尾截断时，在 summary 模式引用的 provider-facing 提示中追加「总结未覆盖中段记录，可使用 read_files 分页读取 source_file 回查」说明
- [x] 4.2 确认 full 模式引用与未截断的 summary 引用不新增截断相关提示，单条记录 24,000 字符上限保持不变

## 5. 测试与验证

- [x] 5.1 扩展 `test/agent/conversation-reference.test.js`：覆盖 compaction 感知素材构造、三级判定、头尾截断（保留头尾/省略标注/输入不超限/单请求）、截断提示文案与按当前模型重算上限
- [x] 5.2 回归 `test/app/composer-submission-controller.test.js` 与 `test/app/conversation-reference-command-port.test.js`，适配 pending 素材结构变化并确认提交生命周期行为不变
- [x] 5.3 运行 `npm run typecheck`、`npm test` 与 `find bin src test scripts -name '*.js' -exec node --check {} \;` 全部通过
- [x] 5.4 手动验证：`npm start` 后引用已压缩长会话得到 full 投影且零摘要请求；引用超长未压缩会话触发单请求截断降级；截断提示出现在引用正文；Esc 取消总结与失败重试行为不变
