## 1. 结构化 grep 展示数据

- [x] 1.1 在 tool 与 transcript 类型中定义带中文字段注释的 grep display metadata，并为 `details.kind: 'grep'` 增加可选 display 字段
- [x] 1.2 调整 grep handler，使成功匹配、无匹配和截断结果携带有序 display metadata，同时保持 provider-visible result text 和失败语义不变
- [x] 1.3 扩展 tool execution 与 transcript persistence 测试，覆盖 metadata 的匹配顺序、空数组、截断子集、失败省略和 journal 重放

## 2. grep 专属 renderer

- [x] 2.1 新增 grep renderer 模块，实现 arguments 摘要解析、display metadata 保守校验、首行查询语义与生命周期标题，以及独立第二行 scope metadata 投影
- [x] 2.2 实现按连续文件分组的结果树、右对齐行列 gutter、低强调主题语义色和有界物理行预算
- [x] 2.3 实现无匹配、失败、handler 截断、renderer 省略和 malformed/legacy fallback 行为
- [x] 2.4 将 grep call 与 pair renderer 接入现有 tool message 分发，确保 footer pending preview 与 transcript 使用一致调用摘要

## 3. 渲染自动化测试

- [x] 3.1 增加 pending、孤立 call、单文件和多文件成功 pair 测试，断言不显示原始 arguments JSON 或 provider 文本协议
- [x] 3.2 增加无匹配、regex 失败、handler 截断、renderer 省略、缺失/非法 metadata 和历史 generic fallback 测试
- [x] 3.3 增加窄终端、长路径、宽字符、Tab、长代码行、自定义主题和原始 transcript record 不变测试
- [x] 3.4 增加低强调样式和最终可见行 safe width 测试，确保树线、gutter 与 continuation prefix 稳定对齐

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`
- [x] 4.2 运行 `npm test`
- [x] 4.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.4 整理 grep pending、成功、无匹配、失败、截断和窄终端场景的交互式 TUI 手动验证清单，交由用户执行
