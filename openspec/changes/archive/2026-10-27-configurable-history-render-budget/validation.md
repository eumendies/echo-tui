# 实施验证记录

## 自动化验证

2026-10-27，Node v24.2.0 / Darwin arm64；以下按实施、review 跟进和归档结项阶段记录结果。

- 定向测试：154/154 通过，覆盖投影、真实 app 恢复/配置/owner 场景、AppContext 状态不变量、实时 renderer 与 headless。
- 按规定顺序运行：`npm run typecheck` → `npm test` → `find bin src test scripts -name '*.js' -exec node --check {} \;`。最终结果：类型检查通过；全量 2285 项，2256 通过、29 跳过、0 失败；JS 语法检查无输出。
- `git diff --check` 通过。
- `openspec validate configurable-history-render-budget --strict` 通过。

全量测试使用独立临时 HOME，并通过现有 bootstrap 创建默认 fake 配置，避免读取个人模型或工具开关。复现方式（已有构建产物时）：

```bash
home=$(mktemp -d)
(
  export HOME="$home"
  node -e "require('./dist/src/config/user-setup-bootstrap').bootstrapEchoUserSetup()"
  npm run typecheck &&
  npm test &&
  find bin src test scripts -name '*.js' -exec node --check {} \;
)
status=$?
rm -rf "$home"
exit "$status"
```

首次在原 HOME 运行时发现一个遗漏新字段的旧配置草稿 fixture，已补齐。另有三项 todo runtime 测试受个人工具开关影响，在独立 HOME 中三项均通过；完全空 HOME 又会令两项既有模型设置/调节测试因缺少模型失败，因此最终使用 bootstrap 的默认 fake 配置，未修改个人配置或无关 runtime。

## Review P3 跟进

- 预算投影统一从 `renderPreferences.historyRenderLineLimit` 读取预算，移除独立参数和 app 重复兜底，同步 benchmark 与测试 helper；新增直接调用回归，确认省略 preferences 为默认 1,000 行，显式 500/1000/2000/0 均按偏好生效。该回归在修改前先验证失败。
- 常规页仅保留单个可选 hint，复用 `normalizeLineLimit()`；小高度测试明确断言焦点始终可见、反馈优先于 hint、最多显示一条说明。
- 本轮按顺序重新执行类型检查、完整测试、JS 语法检查：全部通过；全量 2286 项，2257 通过、29 跳过、0 失败。相关五个测试文件定向运行 99/99 通过。
- 默认确定性 benchmark 结构断言通过；全量/500/1000/2000 的实际行数仍为 15323/500/1013/2037，ANSI UTF-8 字节数仍为 2717277/89492/180251/361571。
- `git diff --check` 和 OpenSpec strict 验证通过。独立只读复核未发现调用签名、活动 run、owner 隔离或小高度布局回归。
- 本轮未处理 P2：稀疏配置保存预算时会顺带补写工具默认值，仍可能触发 usage 清空；此前 context usage 不变量测试仅覆盖 snapshot 刷新，不能据此声称实际保存路径已满足该不变量。
- 再次尝试分配 PTY，仍报 `out of pty devices`；当时未完成真实 TTY 手工验收，任务 4.4 保留未完成，后续由用户确认豁免结项。

## 重点回归覆盖

- 不限与原全量投影等价；有限范围是完整块后缀；宽度重算、隐藏 reasoning/provider-private/parallel/pending 不占预算；预算外正文的访问守卫证明不进入排版。
- 工具对、连续 run、折叠外层报告与过程栏之间的连续依赖区间及重叠依赖不被拆开。
- 真实 journal + createApp + renderer 组合覆盖压缩/未压缩 resume、resize、主题、Undo、fork、provider 输入、预览与配置 surface 保留；显示重绘不读取压缩原文、不写提示记录。
- 保存和外部刷新一次重绘、归一化同值通知去重；BTW/子 Agent 独立投影不裁剪，返回 main 使用最新预算。
- 驻留数组/起点、完整记录数、journal、context usage、checkpoint、todo、输入历史及活动 turn 的 abort signal 不因预算变化而改变。
- 被省略 run 的新事件重新带出标题；正常 append 不因预算清屏；footer tick 不调用预算投影或身份重建、不扫描历史。
- assistant/reasoning/shell 的实时源及 pending 尾部去重、完成边界、光标和命令 surface 保持正确；headless 长回复不被裁剪。

## 确定性基准

完成默认、窄屏及小历史复测，结构断言全部通过。默认全量/500/1000/2000 档中位数分别为 95.513/3.238/6.320/13.101ms；实际行数、ANSI 字节量及测量口径见 [基准结果报告](../../../../docs/history-render-budget-benchmark.md)。只计身份恢复、过滤、排版与拼接，不含 journal 或终端绘制，不设 CI 耗时门槛。开发基准脚本随后按用户要求删除，报告与 fixture 保留，不再提供该脚本的执行命令。

删除脚本后重新按顺序执行类型检查、完整测试和 JS 语法检查，全部通过；全量仍为 2286 项，2257 通过、29 跳过、0 失败。运行时代码与现有测试未修改，P2 及真实 TTY 待办保持不变。

## Hint 补充与归档暂停

- 历史预算的单行 hint 增加“回看受终端滚动历史上限限制”；保持原有恢复行数及不影响模型上下文的说明，不引入多行 hint 或新的布局机制。
- 用户文档和 delta spec 明确区分 scrollback 上限与窗口高度；选择不限也不会改变终端自身的缓冲区配置。
- 更新回归测试，确认默认面板宽度可完整显示说明，切换到其他设置后不残留该 hint；既有窄屏、小高度和反馈优先级测试继续通过。
- 按顺序重新运行类型检查、完整测试和 JS 语法检查，全部通过；全量 2286 项，2257 通过、29 跳过、0 失败。
- 用户确认过未来归档可按 TTY 豁免、P2 保留的方式结项，随后要求先修改 hint；该阶段未执行 spec 主库同步、归档、提交或分支合并。随后用户已确认继续，真实 TTY 仍未实测，P2 仍未修复。

## 归档结项与已接受风险

- 用户明确确认继续同步 spec、归档、提交并合并到 dev，不执行 push。
- 三份主 spec 已同步：新增 `history-render-budget` 的 6 条需求，配置规范新增 2 条并修改 2 条，终端规范修改 8 条；同步时逐条核对 delta 内容并确认无关需求未改变。
- 已归档至 `openspec/changes/archive/2026-10-27-configurable-history-render-budget/`，保留 `.openspec.yaml`；归档前 strict 验证通过。CLI 仅提示超过 10 条 delta 的非阻塞拆分建议。
- 24 项任务全部结项，其中 4.4 为用户确认豁免，不是实际验证通过。
- 已知 P2 保留：稀疏配置只保存预算时，保存链路可能补写工具默认值并清空 context usage；现有测试通过不代表该问题已修复。
- 归档后的首次完整测试有一项现有 glob 输出预算测试失败；该项独立复跑通过，随后重新按顺序执行类型检查、完整测试和 JS 语法检查，全部通过：2286 项，2257 通过、29 跳过、0 失败。该次失败根因未定位，未修改 glob 实现或测试来规避。
- 主 spec 全量 strict 验证通过：84/84；归档文档中的基准报告相对链接已按新目录深度修正。

## 真实 TTY 手工验收豁免（任务 4.4）

当前工具仅支持非交互命令。曾尝试以 Python 标准库 PTY 启动 `npm start`，但 `pty.openpty()` 即报 `OSError: out of pty devices`，应用尚未启动；不能声称完成 PTY 冒烟或真人视觉验证。以下项目按用户要求标记为豁免结项，勾选不表示执行或通过，自动化 renderer/controller 测试不能替代这些人工检查：

- [x] 【豁免，未实测】`npm start`；长历史 `/resume`，完整边界块、预算提示与压缩提示分别展示。
- [x] 【豁免，未实测】`/config → 常规` 全部档位/不限、草稿隔离、保存、焦点/反馈、外部修改与同值通知。
- [x] 【豁免，未实测】窄屏 resize、主题/推理显示切换、BTW 与子 Agent 视图返回。
- [x] 【豁免，未实测】assistant/reasoning/shell 流式重绘、稳定前缀/pending 去重、footer 与光标。
- [x] 【豁免，未实测】输入编辑、Ctrl+J/Enter、真实/fake 流式响应、Ctrl+C/Ctrl+D 终端清理。
- [x] 【豁免，未实测】scrollback 增长、非 alternate screen、角色配色、Markdown/代码/表格和工具块观感。
