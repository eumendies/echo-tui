## 1. glob display metadata

- [x] 1.1 在 tool 与 transcript 类型中定义带中文字段注释的 glob display metadata，并为 `details.kind: 'glob'` 增加可选 display 字段
- [x] 1.2 调整 glob handler，使成功匹配、无匹配和截断结果携带有序 paths metadata，同时保持 provider-visible result text 和失败语义不变
- [x] 1.3 扩展 tool execution 与 transcript persistence 测试，覆盖路径顺序、空数组、截断子集、失败省略和 journal 重放

## 2. glob 专属 renderer

- [x] 2.1 新增 glob renderer 模块，实现 arguments 摘要解析、display metadata 保守校验、查询生命周期标题和独立 scope 行
- [x] 2.2 实现按原始顺序投影的扁平路径树、低强调主题样式、Tab/控制换行规范化和有界单路径换行
- [x] 2.3 实现无文件、失败、handler 截断、仅按共享物理行预算计算的 renderer 省略，以及窄终端和 malformed/legacy fallback
- [x] 2.4 将 glob call 与 pair renderer 接入现有 tool message 分发，确保 footer pending preview 与 transcript 使用一致摘要，并让成功、pending、失败 marker 分别使用 toolSuccess、中性和 toolError 状态

## 3. 渲染自动化测试

- [x] 3.1 增加 pending、孤立 call、默认及多 roots、单文件和多文件成功 pair 测试，断言不显示原始 arguments JSON 或 provider 文本协议
- [x] 3.2 增加无文件、执行失败、handler 截断、renderer 省略、缺失/非法 metadata 和历史 generic fallback 测试
- [x] 3.3 增加窄终端、长路径、宽字符、Tab、CR/LF、自定义主题和最终可见行 safe width 测试
- [x] 3.4 增加结果顺序、无目录节点重建、状态 marker 颜色、共享行预算利用率和原始 transcript record 不变测试

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`
- [x] 4.2 运行 `npm test`
- [x] 4.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.4 整理 glob pending、成功、无文件、失败、handler 截断、renderer 省略和窄终端场景的交互式 TUI 手动验证清单，交由用户执行
