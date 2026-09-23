## 1. 输入解析与文件模拟

- [x] 1.1 将 `parsePatchText` 限定为 Begin Patch，删除 unified diff parser 和专用辅助函数；保留前导空行、公共缩进、数字 `@@` 头和混入文件头的拒绝语义。
- [x] 1.2 移除 `matchMode`、独立唯一匹配和 unified diff 删除 hunk 校验，保留 Begin Patch 顺序更新、Delete File 安全检查与 all-or-nothing 写盘。

## 2. 工具说明与授权摘要

- [x] 2.1 更新 `apply_patch` 工具 definition 和 provider-visible 参数说明，只声明 Begin Patch Add/Update/Delete File 格式。
- [x] 2.2 将工具调用标签与审批大 patch 路径摘要收敛为 Begin Patch 文件指令；保留删除标记、审批安全回退和路径的字面含义。

## 3. 测试与文档

- [x] 3.1 将依赖 unified diff 成功执行的 apply_patch 测试改写为 Begin Patch；补充旧格式拒绝、混入格式拒绝、数字更新块和无文件改动断言。
- [x] 3.2 更新审批、风险分类、渲染及 provider schema 相关用例，验证删除预览、无法摘要时的安全回退，以及 result metadata 和 `/diff` 不受影响。
- [x] 3.3 更新 `docs/tui-architecture.md`，明确 apply_patch 仅接收 Begin Patch，`/diff` 的统一差异展示保持独立。
- [x] 3.4 依次运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`，并检查 `git diff --check`。
