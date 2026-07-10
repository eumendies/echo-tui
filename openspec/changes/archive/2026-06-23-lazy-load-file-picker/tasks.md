## 1. 文件发现与状态模型

- [x] 1.1 重构 `src/app/state/file-picker-context.ts` 的 file picker 状态，将打开时全量 `paths` 扫描改为当前目录 entries 状态，并保留 `currentDir`、focus、query、selectedPaths、previewScroll 等交互状态。
- [x] 1.2 新增目录级加载函数，读取指定相对目录的直接子文件和子目录，按目录优先、名称排序输出，并避免递归扫描完整目录树。
- [x] 1.3 为目录读取失败、不可读目录和空目录生成可见 notice 或空状态，避免用户看到无解释的空白列表。

## 2. 浏览、搜索与 preview 语义

- [x] 2.1 更新进入目录、返回父目录、移动当前项、Space 多选和 Enter 插入逻辑，使其基于懒加载 entries 工作，并保持现有 mention 插入格式不变。
- [x] 2.2 重新设计 query 过滤：至少支持当前目录直接子项过滤；如果保留 cwd 范围路径搜索，必须实现有界结果和 buffer 安全处理。
- [x] 2.3 更新目录 preview，不再依赖全量 `state.paths` 统计后代文件；改为展示直接子项数量或进入目录提示。
- [x] 2.4 保持文本、PDF、图片和不支持文件的 preview 语义，并避免对不可见的大量搜索结果做无界同步文件类型检测。

## 3. 渲染与用户反馈

- [x] 3.1 如有必要，调整 `src/render/footer/file-picker-surface.ts` 的空列表、notice 或读取失败展示，保持两栏布局、安全宽度和 footer 高度约束。
- [x] 3.2 确认大目录下打开 `@` 时首屏能显示直接子目录/文件，且不会因 `rg`/buffer 错误静默空白。

## 4. 测试与验证

- [x] 4.1 更新 `test/app/file-picker-context.test.js`，覆盖打开时只加载直接子项、进入子目录懒加载、返回父目录、空目录和不可读/读取失败反馈。
- [x] 4.2 更新 query 相关测试，覆盖大目录或大量文件场景下不会因为输出过大导致 entries 为空。
- [x] 4.3 更新或补充 footer renderer 测试，覆盖空状态/notice 展示和宽度约束。
- [x] 4.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.5 手动验证 `npm start` 在 `/Users/example/projects` 下输入 `@` 能显示直接子文件和子目录，并验证进入子目录、返回、过滤、选择和插入 mention。
