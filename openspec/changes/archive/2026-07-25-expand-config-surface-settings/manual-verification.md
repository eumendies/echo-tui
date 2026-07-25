# Manual Verification Checklist

以下交互式检查交由用户在真实 TTY 中执行：

- `/config` 默认打开“常规”，Tab 可单向循环三个 Tab；各 Tab 的选择、子页面和未保存草稿在切换后保留。
- 修改常规和模型草稿后按 Esc，确认共享放弃提示同时列出 dirty Tab；模型嵌套页面的 Esc 先返回上一级。
- 常规设置可独立保存；数值边界分别为压缩阈值 50%–95%、Slash 建议 1–20，推理摘要开关可切换。
- 在“外观”连续切换多个主题，确认每次立即保存并完整重绘；保存失败时 marker 和旧主题保持不变。
- 关闭推理摘要后历史与新增摘要均隐藏，重新开启后历史摘要从 transcript 恢复；退出最终渲染遵守当前开关。
- 将 Slash 可见数量设为较小值，确认 Up/Down 可滚动到隐藏候选，Tab 可补全非前 N 项，窄/矮终端不溢出。
- 外部编辑 `~/.echo/config.json`，确认 model、常规缓存刷新；Slash 数量变化只重绘 footer，推理显示变化执行 destructive replay。
- 启动一次含 tool continuation 的回答后再修改压缩阈值，确认当前 run 使用旧快照，下一次回答使用新值；手动 `/compact` 不受阈值限制。
