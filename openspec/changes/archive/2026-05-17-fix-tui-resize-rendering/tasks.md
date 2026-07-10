## 1. 渲染状态模型

- [x] 1.1 在 app 层引入 transcript records，保存 user/assistant 已提交消息的结构化内容
- [x] 1.2 将提交逻辑从“直接追加已渲染字符串”调整为“追加 record 后触发 render projection”
- [x] 1.3 保持 transcript content records append-only：提交后的消息内容不被 resize 或 redraw 修改

## 2. App-owned 区域重绘

- [x] 2.1 设计并实现 app-owned 可见区域 renderer，统一渲染 banner、transcript projection、pending preview、divider、composer 和 hint
- [x] 2.2 renderer 记录上一次 app-owned 区域高度，重绘前只清理应用启动后自己绘制的可见区域
- [x] 2.3 resize、composer 编辑、thinking spinner、streaming token 和 completion 都复用同一个 render 入口
- [x] 2.4 保持不切 alternate screen、不清空应用启动前已有 terminal scrollback

## 3. 宽度计算和视觉布局

- [x] 3.1 在 `src/render/layout.js` 增加统一的安全渲染宽度 helper，避免各模块重复处理 `columns - 1`
- [x] 3.2 调整 footer divider 生成逻辑，确保 resize 后按当前宽度重算且不会写满最后一列触发自动换行
- [x] 3.3 保留用户消息整行灰色背景，并在每次 render projection 时按当前宽度重新 pad 和 wrap
- [x] 3.4 确保 user、assistant、pending preview、composer 的 wrap 和 indent 都基于 `displayWidth`，兼容中文宽字符

## 4. Resize 行为修复

- [x] 4.1 将 resize handler 调整为触发完整 app-owned 区域重绘，而不是只重绘 footer
- [x] 4.2 修复 resize 前后高度变化时的清理和光标恢复，避免残留多条分割线或旧宽度灰底
- [x] 4.3 覆盖 thinking spinner、streaming pending preview、已完成 transcript 和空 composer 四种状态下的 resize 重绘
- [x] 4.4 清理上一次 app-owned 区域时按当前终端宽度估算旧输出被 reflow 后的物理行数，避免 resize 后重复 banner 或 transcript

## 5. 文档和规格同步

- [x] 5.1 更新 `docs/README.md`，说明 transcript 内容 append-only、渲染 projection 可重算
- [x] 5.2 更新 `docs/tui-architecture.md`，说明 transcript records、app-owned render region 和 resize 重绘边界
- [x] 5.3 保持代码中的新增注释为中文，并避免引入无关抽象

## 6. 验证

- [x] 6.1 运行 `node --check` 覆盖 `bin/` 和 `src/` 下所有 JavaScript 文件
- [x] 6.2 运行 `openspec validate fix-tui-resize-rendering`
- [x] 6.3 运行 `npm start`，手动验证启动后 resize 不产生多条分割线
- [x] 6.4 提交中文长文本并在完成后反复变窄、变宽，验证用户消息整行灰底按当前宽度重新覆盖
- [x] 6.5 在 assistant thinking 和 streaming 中 resize，验证 pending、divider、composer、hint 顺序和光标位置正确

## 7. destructive shrink recovery 替代方案

> 说明：1-6 对应的整段 app-owned region 重绘方案已经完成并验证了中短内容场景，但长消息 + width shrink 仍会被终端 reflow 和 scrollback 边界击穿。以下任务用于把该中间方案替换为 destructive clear + full repaint。

- [x] 7.1 在 `src/app/main.js` 跟踪上一次 terminal columns，并在 terminal columns 变化时触发 destructive recovery 分支
- [x] 7.2 在 `src/terminal/ansi.js` 增加或整理 destructive clear 所需 helper，表达 reset scroll region、reset style、cursor home、clear visible screen 和 clear scrollback 等语义
- [x] 7.3 调整 `src/render/app-region.js` 或同类模块：支持从左上角输出完整 app snapshot，并在 shrink 路径上绕开旧区域高度估算与局部擦除逻辑
- [x] 7.4 让 shrink recovery 的完整快照包含 banner、transcript projection、pending preview、divider、composer 和 hint，并在重绘后恢复 composer 光标位置
- [x] 7.5 保持 width grow、height 变化、thinking spinner、streaming token、completion 和 composer 编辑仍通过统一 render 入口工作，但允许 render mode 切换到 destructive recovery
- [x] 7.6 更新 `docs/README.md`、`docs/tui-architecture.md` 和相关 spec，明确 width shrink 会清 visible screen 与 scrollback，这是显式接受的产品语义
- [x] 7.7 运行 `node --check`，并手动验证长消息、中文宽字符、thinking/streaming 中反复改变列宽时不再出现重复 banner、重复 transcript 或残留灰底/分割线；同时记录主用终端对 `ESC[3J]` 的兼容性
