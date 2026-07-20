## 1. 层级展示投影

- [x] 1.1 在 context surface renderer 中按 category 读取互斥 segment，并将 System prompt 展示值聚合为 `system + memory + skills`
- [x] 1.2 构造固定顺序的 System prompt、Tools、Messages、Reasoning 顶层分类，确保 composition bar 只消费这些互不重叠的值
- [x] 1.3 将非零 Memory 与 Skills 渲染为 System prompt 的缩进子项，仅显示 token 明细并保留可辨识的颜色

## 2. Footer 布局约束

- [x] 2.1 调整 context card 行生成顺序，使父子分类保持相邻且顶层行不再按 token 数排序
- [x] 2.2 为 context surface 增加按信息优先级的行预算处理，在空间不足时先省略 Memory 与 Skills 子项和次要留白
- [x] 2.3 保持窄终端安全宽度、边框列宽和最终最大行数约束

## 3. 自动化测试与验证

- [x] 3.1 更新 footer 渲染测试，覆盖 System prompt 聚合值、固定顶层顺序、Memory/Skills 父子关系及子项无全局百分比
- [x] 3.2 更新 composition bar 与小终端测试，验证父子项不重复计入且裁剪优先移除子项
- [x] 3.3 运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查
