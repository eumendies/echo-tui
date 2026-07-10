## 1. Slider Surface Visual

- [x] 1.1 在 `src/terminal/ansi.ts` 增加 RGB 前景色 helper，用于 cyan gradient 和柔和轨道颜色。
- [x] 1.2 调整 `/effort` scale options，保留真实 effort value，同时提供大写缩写 display label（`NONE`、`MIN`、`LOW`、`MED`、`HIGH`、`XHIGH`）。
- [x] 1.3 重写 `renderScaleSurface()`，使用圆角边框、cyan 标题和 `[live]` 状态。
- [x] 1.4 复刻 demo 轨道视觉：`◂` / `▸` 箭头、`●` 档位点、`◉` 当前 knob、已选 cyan 轨道和未选 dim 轨道。
- [x] 1.5 在轨道下方居中展示大写缩写档位，并高亮当前选中项。
- [x] 1.6 在左下方展示当前真实 effort value、`█/░` 进度 meter 和 `active` 状态。
- [x] 1.7 保持窄终端安全裁剪，不写满终端最后一列。

## 2. Tests

- [x] 2.1 更新 `test/render/footer.test.js`，覆盖圆角边框、cyan title、`◂` / `▸`、`●` / `◉`、大写 label、meter 和 help line。
- [x] 2.2 更新 `/effort` command 测试，确认 surface option 仍保留真实 value，同时携带 display label。
- [x] 2.3 确认没有引入 demo 的额外 key handling 行为，Left/Right/Enter/Esc 语义不变。

## 3. Documentation

- [x] 3.1 更新 `docs/README.md` 中 `/effort` UI 描述，说明其为 rounded cyan slider。
- [x] 3.2 更新 `docs/tui-architecture.md` 中 scale surface 描述，说明 slider visual 与交互边界。
- [x] 3.3 确保 OpenSpec 主规格归档时包含 neon slider 视觉要求。

## 4. Validation

- [x] 4.1 运行 `npm run typecheck`。
- [x] 4.2 运行 `npm test`。
- [x] 4.3 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.4 手工打开 `/effort`，确认视觉接近 `terminal_reasoning_slider_neon.py` 且 Left/Right 切换正常。
