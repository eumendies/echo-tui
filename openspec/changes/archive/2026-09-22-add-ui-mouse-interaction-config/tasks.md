## 1. 常规设置与配置中心

- [x] 1.1 在 AppSettings 中加入默认关闭的 `ui.mouseInteractionEnabled`，完成字段归一化、草稿校验、原子保存和配置单测。
- [x] 1.2 在 `/config`“常规”Tab 加入名称为“UI 鼠标交互”的开关行，完成焦点顺序、Enter/Left/Right 调整、保存反馈和草稿隔离测试。
- [x] 1.3 更新用户配置示例或设置文档，说明默认关闭、开启方式及终端 scrollback 取舍。

## 2. TUI 鼠标能力门控

- [x] 2.1 将 UI 鼠标交互设置纳入 AppContext 的 settings cache 与变更分类，使保存和 watcher 更新触发普通 footer 重绘而不重放 transcript。
- [x] 2.2 在 render 投影处仅为已开启设置的当前 pointer consumer 传递 `footerInteractionId`，确保关闭时不产生可执行 hit region。
- [x] 2.3 保持 FooterPointerController 的协议职责不变，并验证关闭或热关闭设置会停用鼠标报告、失效 frame/CPR、拒绝迟到事件；开启后仅在可操作 surface 存在时恢复既有校准与路由。

## 3. 回归验证

- [x] 3.1 增加或更新配置、render、pointer controller 和 app watcher 测试，覆盖缺失/非法默认关闭、显式开启、保存前隔离、热开启/关闭、键盘 fallback、非 TTY 与 headless 边界。
- [x] 3.2 运行 `npm run typecheck`、`npm test` 与 `find bin src test scripts -name '*.js' -exec node --check {} \;`，修复回归。
- [x] 3.3 在真实 TTY 手工验证默认滚轮 scrollback、开启后的 hover/点击与 scrollback 取舍、运行中切换开关、surface 关闭/退出清理、resize/CPR 与 tmux 或至少一个常用终端复核。
