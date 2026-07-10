## 1. 资源模型与发现

- [x] 1.1 在 skill 类型中增加附加资源清单结构，表达 skill-root-relative 路径。
- [x] 1.2 在 skill registry 解析有效 `SKILL.md` 后扫描 `reference/` 与 `scripts/` 下的普通文件。
- [x] 1.3 确保资源路径使用稳定排序的扁平相对路径，且资源目录不可读时不让 skill 加载失败。

## 2. 加载文本输出

- [x] 2.1 更新 `use_skill` tool result，在有资源时追加 `[Skill Resources]` 与 `- <relative-path>` 清单。
- [x] 2.2 更新 direct slash skill invocation 注入文本，复用同样的资源清单格式。
- [x] 2.3 确保无资源时不输出空的 `[Skill Resources]` 区块，且 skill catalog 仍只包含名称和描述。

## 3. 测试覆盖

- [x] 3.1 补充 registry 测试，覆盖 `reference/`、`scripts/`、稳定排序、普通文件过滤和资源发现失败降级。
- [x] 3.2 补充 `use_skill` 测试，覆盖扁平资源清单输出和无资源时省略空区块。
- [x] 3.3 补充 direct slash invocation 或 command host 测试，验证 user message 包含同等资源清单。
- [x] 3.4 补充 system prompt/catalog 测试，确认资源路径不会进入常驻 skill catalog。

## 4. 文档与验证

- [x] 4.1 更新 `docs/README.md` 或架构文档，说明 skill 可发现附加资源路径但不自动读取或执行。
- [x] 4.2 运行 `npm run typecheck`。
- [x] 4.3 运行 `npm test`。
- [x] 4.4 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.5 手动确认带 `reference/` 或 `scripts/` 的 skill 通过 `use_skill` 和 `/<skill-name>` 均显示扁平资源清单。
