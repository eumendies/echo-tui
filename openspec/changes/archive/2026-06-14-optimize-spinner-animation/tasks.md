## 1. 共享 echo spinner 渲染

- [x] 1.1 新增或调整渲染层 helper，定义固定宽度 echo wave field 帧表和帧间隔。
- [x] 1.2 实现根据 `elapsedMs` 选择 echo spinner 帧的纯函数，确保非法或负数 elapsed 输入稳定回退到首帧。
- [x] 1.3 实现 spinner cell 的 cyan 强弱着色，复用现有 RGB palette 工具，并确保空白 cell 不输出未闭合 ANSI 样式。

## 2. Status line 接入

- [x] 2.1 将 thinking 状态投影到 status line 状态段，替代 ready/PLAN。
- [x] 2.2 将 working 状态投影到 status line 状态段，并保留 elapsed time。
- [x] 2.3 保持非响应中 ready/PLAN 状态段逻辑不变。
- [x] 2.4 为 thinking/working 文案恢复中心向两侧扩散扫光，使用 gray / white / bold white 三层过渡，并复用 echo spinner 完整帧周期和空白暂停帧。

## 3. 独立行移除

- [x] 3.1 移除 thinking pending preview 的独立 spinner/prefix 行。
- [x] 3.2 移除 working footer 独立行，避免额外占用 transcript/composer 间隔上方空间。
- [x] 3.3 移除或替换不再使用的旧 spinner/shimmer 逻辑，避免 thinking 与 working 分叉。
- [x] 3.4 将 composer 上方实线 divider 替换为命名的 transcript/composer 语义空行。

## 4. 测试与验证

- [x] 4.1 更新 `test/render/blocks.test.js`，覆盖 thinking pending 不再渲染独立 preview 行。
- [x] 4.2 更新 `test/render/footer.test.js`，覆盖 thinking/working status line 动画、elapsed time 保留和独立 working 行移除。
- [x] 4.2.1 覆盖 thinking/working 文案灰色未扫区域、白色过渡、bold white 主扫光，以及 thinking 扫光从中心向两侧扩散。
- [x] 4.2.2 覆盖 spinner 空白暂停帧期间文案扫光也暂停。
- [x] 4.3 运行 `npm run typecheck`。
- [x] 4.4 运行 `npm test`。
- [x] 4.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.6 覆盖响应中 status line 不追加 `Ctrl+C 退出` key hint，避免右侧状态段宽度抖动。
