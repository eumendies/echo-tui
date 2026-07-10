## 1. 收口渲染门面与模块命名

- [x] 1.1 将 `src/render/app-region.js` 重命名为更贴切的 `src/render/app-renderer.js`，并同步导出工厂与辅助函数命名。
- [x] 1.2 在新的 app renderer 中统一编排 footer-only redraw、transcript append 和 destructive replay 三类渲染路径，内部组合 `footer.js` 与 `blocks.js`，而不是让 `main.js` 直接操纵它们。

## 2. 调整 app 编排层与测试边界

- [x] 2.1 更新 `src/app/main.js` 的依赖注入和调用方式，使 app 层只通过单一 app renderer 接口表达渲染事件，不再直接调用 footer renderer、block renderer 或 `output.write`。
- [x] 2.2 更新自动化测试，特别是 `test/app/main.test.js`、`test/render/app-region.test.js`（及重命名后的对应文件），让测试围绕新的 renderer 门面断言 normal redraw、append path 和 resize replay 的行为不变。

## 3. 同步文档与完成验证

- [x] 3.1 更新 `docs/tui-architecture.md`、`docs/README.md` 中关于 `app-region` 的文件路径、模块图和职责描述，使术语与新门面一致。
- [x] 3.2 运行 `npm test` 与 `find bin src test -name '*.js' -exec node --check {} \;`，确认这次是行为不变的重构且命名替换完整。
