## 1. 引用状态与编辑模型

- [x] 1.1 为 composer 定义已确认引用和独立草稿快照，使用 grapheme 半开范围和确认路径；新增结构类型的字段使用中文说明领域含义。
- [x] 1.2 收敛插入、替换、Backspace、Delete、删词、删行和换行的文本变更逻辑，实现范围前后平移、边界插入及相交撤销规则。
- [x] 1.3 区分普通 setText/reset 与内部快照恢复；前者清空引用，后者恢复独立副本，避免共享可变数组。
- [x] 1.4 增加编辑模型测试，覆盖多引用、尾随空格、紧邻中文/标点、内部编辑后改回原文、emoji/组合字符及全部删除操作。

## 2. 触发与显式确认

- [x] 2.1 在输入事件和有状态/无状态 bracketed paste 解析路径中保留粘贴来源，测试单字符 `@` 和跨 chunk 的 paste 起止序列，保持换行不误提交。
- [x] 2.2 收紧 `@` 自动触发条件：普通/计划模式、文本开头或空白后、非粘贴、非已有引用内部，并保持原 surface 输入优先级。
- [x] 2.3 修改 file picker Enter 确认，原子插入格式化文本及每个路径的引用范围；保留多选、目录、空格文件名和尾随空格，Esc/query/Space/鼠标操作不建立引用。
- [x] 2.4 增加解析器、输入控制器和 file picker 测试，覆盖邮箱、版本号、无分隔中文、粘贴、取消、无可选项和多选范围。

## 3. 渲染与显式文件展开

- [x] 3.1 将 composer 高亮改为消费已确认引用范围，移除渲染时的文本 mention 推断；不新增文件系统读取，保持原光标、ANSI 和自动换行语义。
- [x] 3.2 将文件展开入口改为使用提交显式提供的路径集合；无引用时不扫描文本、不读取文件、不生成路径错误，保留现有路径去重及读取限制。
- [x] 3.3 更新渲染和展开测试，区分同形已确认/普通文本，覆盖确认后路径不存在、目录/PDF/图片、自动压缩、读取失败与重复引用。

## 4. 提交、排队与输入历史

- [x] 4.1 在消费 composer 前捕获引用快照，接入普通提交和失败/取消恢复；提交未接受时不改变原草稿，异步恢复不覆盖新草稿。
- [x] 4.2 普通 pending enqueue/claim/dispatch 保存独立确认路径，steer 直接使用接收快照准备最终 record，不重复保存编辑范围；保持实际读取时机、单槽和一次性交付约束。
- [x] 4.3 为当前会话输入历史保存引用快照，按条目恢复并保持原字符串历史投影兼容；旧纯文本历史不推断引用。
- [x] 4.4 审核命令、skill/workflow 和会话引用路径：只保留关联原草稿明确确认的路径，不扫描生成文本，不把旧范围索引套到新文本；shell/本地 handled 命令不额外展开。
- [x] 4.5 增加真实 controller/context 组合测试，覆盖 pending A/live B 隔离、steer 异步成功/失败与迟到回调、提交恢复、单槽拒绝、同文本不同历史资格及恢复后再编辑。
- [x] 4.6 增加命令生成文本和 headless 纯文本入口回归测试，确认不从 `@` 自动附带文件、不借用 live composer 引用，并清理旧自动解析的生产调用和过时测试。

## 5. 文档与验证

- [x] 5.1 更新用户说明：`@` 合法触发位置、Enter 确认、Esc 取消、手写/粘贴路径不自动附带、内部编辑撤销及当前会话/旧历史区别。
- [x] 5.2 按顺序执行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;` 并记录结果。
- [x] 5.3 真实终端验收以用户明确豁免关闭（未实际执行，非验证通过）：原计划通过 `npm start` 定向验证引用确认/取消、多选、粘贴单个 `@`、邮箱输入、编辑边界、Unicode、resize、历史、pending/steer 隔离、shell 模式及 Ctrl+C/Ctrl+D 清理，并按仓库清单检查相关回归；当前环境 PTY 权限受阻，用户已确认保留限制并继续同步、归档和合并。
- [x] 5.4 验证 headless fake agent、非 TTY 输出和原工具拒绝策略不受影响；运行 `openspec validate confirmed-file-mentions --strict`，更新任务完成状态，不擅自提交代码。

## 6. Review 收敛

- [x] 6.1 无引用编辑只重分段必要后缀，取消全文坐标表构造；增加与完整 Unicode 分段对照及大段粘贴测试。
- [x] 6.2 普通 pending 只保存独立路径数组，steer 槽位不重复保存引用范围，更新隔离测试。
- [x] 6.3 输入历史统一保存快照，移除仅测试使用的字符串兼容分支，测试改用正常草稿/快照入口。
- [x] 6.4 Esc 刷新返回单事件或空值，移除数组循环；保留异步错误传播和退出取消，补充回归测试。
- [x] 6.5 对 review 修正重新执行完整验证序列、OpenSpec 校验和相同工作负载微基准，记录结果及真实终端验收限制。

## 验证记录

- 首轮按顺序执行 typecheck、全量测试和 JS 语法检查，全部通过；测试共 2444 项，2415 通过、29 跳过、0 失败。测试输出保存在本次运行环境的 `/tmp/echo-confirmed-mentions-tests.log`。
- Review 修正后重新按顺序执行 typecheck、全量测试和 JS 语法检查，全部通过；测试共 2448 项，2419 通过、29 跳过、0 失败。测试输出保存在 `/tmp/echo-mentions-review-tests.log`；OpenSpec 严格校验与 `git diff --check` 也通过。
- 相同环境对修正前/后编译代码做 ASCII 无引用单字符插入微基准，每种工作负载 3 次取中位数：10 万字符末尾追加约 3.02 → 0.001ms/次，100 万字符末尾追加约 35.45 → 0.09ms/次，10 万字符中部插入约 2.77 → 0.99ms/次。仅测编辑、不含渲染，不代表整体终端延迟；完整结果位于 `/tmp/echo-mentions-review-benchmark.json`。
- 归档前 `openspec validate confirmed-file-mentions --strict` 与 `git diff --check` 通过。
- 临时 HOME 下使用真实编译 CLI 和默认 fake agent，以非 TTY 方式运行包含 `@README.md`、`@missing` 和邮箱的 `--once`；默认与 `--full-access` 均正常退出，原文未被 mention 展开。默认 deny 和显式 full-access 的工具行为由自动化测试覆盖；fake agent 本身不调用工具。补充验证报告保存在本次运行环境的 `/tmp/echo-mentions-smoke/REPORT.md`。
- 5.3 用户豁免关闭：Python `openpty` 和系统 `script` 均被当前环境拒绝（`Operation not permitted`），review 修正后再次尝试 `openpty` 仍被拒绝，无法启动 PTY 下的 `npm start`。引用确认/编辑、Unicode、历史、pending/steer、粘贴分包和 Esc 判别已有自动化覆盖，但不能代替真实终端的视觉、resize、流式渲染及退出清理验收。2026-10-29 用户明确同意按豁免关闭、同步主规格并归档、提交和合并到 dev；真实终端验收仍未执行，不声明通过。
- 2026-10-29 已将 4 项修改需求和 3 项新增需求同步到主规格，保留预览布局与 user 图片附件转换要求，并归档到 `openspec/changes/archive/2026-10-29-confirmed-file-mentions/`。提交合并前重新按顺序运行 typecheck、全量测试和 JS 语法检查，2419 通过、29 跳过、0 失败；`openspec validate --all --strict` 共 85 项通过，`git diff --check` 通过。完整输出位于 `/tmp/echo-mentions-merge-tests.log` 和 `/tmp/echo-mentions-merge-specs.log`。
