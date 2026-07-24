## Composer model/effort 调节手动验证

由用户在真实交互终端中执行以下检查：

- [ ] 运行 `npm start`，在空 composer 按 `Ctrl+T`，确认 box 内 placeholder 替换为 `Tab 切换字段 · ←/→ 调整 · Enter 应用 · Esc 取消`，且 footer 未增加额外 hint 行。
- [ ] 预先输入多行草稿并把光标移到文本中间，再按 `Ctrl+T`；确认用户文本保持原样、不显示调节 placeholder，status line 高亮 model 字段。
- [ ] 使用 `Tab` 和 `Shift+Tab` 在 model/effort 间切换，确认不会切换 interaction mode 或工具授权；使用左右键确认候选首尾循环。
- [ ] 切换不同 model，确认 effort 自动显示该目标 profile 的现有配置；未配置时以 `medium` 作为起点，且候选中没有“模型默认”。
- [ ] 按 `Esc` 和再次按 `Ctrl+T` 分别取消，确认草稿、光标、model、effort 和 transcript 均不变化。
- [ ] 按 `Enter` 应用选择，确认 status line 更新、`~/.echo/config.json` 同时保存 selected model 与目标 effort，并由下一次真实/fake response 使用新配置。
- [ ] 从 `/` slash suggestion 可见状态进入调节，确认 suggestion 暂时隐藏，取消后按原草稿恢复。
- [ ] 在 assistant response、MCP 初始化、shell、shell-local、slash command surface、tool approval、file picker 和 user question 中按 `Ctrl+T`，确认不会启动调节模式。
- [ ] 模拟配置不可写或目标 model 被外部删除后按 Enter，确认调节模式保留、错误已脱敏、草稿未丢失，并可按 Esc 取消。
- [ ] 在调节期间缩放终端到窄宽度再恢复，确认 composer/status line 不越过安全宽度、无残留行，退出后光标恢复到原逻辑位置。
