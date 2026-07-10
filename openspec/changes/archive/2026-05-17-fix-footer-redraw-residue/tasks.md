## 1. 恢复 normal path 的 footer-only redraw

- [x] 1.1 在 `src/app/main.js` 中重新区分普通 footer 重绘、transcript 追加和 resize destructive replay 三类渲染入口。
- [x] 1.2 在 `src/render/footer.js` 中恢复并接入 footer renderer，使输入编辑、spinner 和 pending 更新只重绘 footer。

## 2. 收敛 transcript append 与 full replay 责任

- [x] 2.1 调整用户提交和 assistant 完成路径，改为“清临时 footer → 追加 transcript block → 重绘 footer”。
- [x] 2.2 收敛 `src/render/app-region.js` 的职责，使完整快照重放只服务于 resize destructive recovery 和退出前最终渲染。

## 3. 验证残留问题不回归

- [x] 3.1 更新或新增自动化测试，覆盖普通输入/pending 更新不重放 banner 与 transcript、追加路径只新增 transcript block、resize 才 full replay。
- [x] 3.2 运行 `npm test` 与 `find bin src test -name '*.js' -exec node --check {} \;`，并手动验证输入、pending、scrollback 上滑和 resize 场景。
