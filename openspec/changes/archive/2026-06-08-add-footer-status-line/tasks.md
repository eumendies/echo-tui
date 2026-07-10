## 1. 状态建模与组装

- [x] 1.1 在 render 类型中新增 status line 状态，替换普通 composer 对静态 `hint` 的依赖。
- [x] 1.2 在 app/render context 中根据 cwd 生成短项目名，并组装 status line 基础信息。
- [x] 1.3 复用 `ModelContext` 当前选择，读取并格式化 status line 的模型名称或等价模型标识。
- [x] 1.4 根据已有 render state 推导 idle、command、thinking、streaming 和 tool pending mode。
- [x] 1.5 为不同 mode 配置对应快捷键提示，保持 command surface 自身 `dismissHint` 不变。

## 2. Footer 渲染

- [x] 2.1 将普通 composer surface 底部 hint 行替换为 status line。
- [x] 2.2 实现 status line 文本格式和 ANSI 样式，并按 safe render width 裁剪。
- [x] 2.3 确保 slash suggestion、pending preview、working 行、divider、composer 和 status line 的相对顺序稳定。
- [x] 2.4 确保 info/select/confirm/choice surface 继续显示自身提示，不渲染全局 status line。

## 3. 规格与测试

- [x] 3.1 更新主规格 `openspec/specs/terminal-tui-prototype/spec.md`，同步 footer status line 行为。
- [x] 3.2 更新 footer layout 测试，覆盖 idle status line、模型信息、slash command status line 和 pending/tool mode。
- [x] 3.3 更新 app renderer 或 main 测试，覆盖 render state 中 status line 的传递和 resize recovery 快照。
- [x] 3.4 更新或移除旧 hint 相关断言，确保测试描述使用 status line 语义。

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`。
- [x] 4.2 运行 `npm test`。
- [x] 4.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.4 运行 `openspec validate --all --strict`。
