# 实施验证记录

## 归档决定（2026-10-23）

- 用户明确要求“全部勾选然后继续归档”，并确认先同步主规格。任务清单的 38/38 勾选表示按该决定关闭流程，不是新增的实测通过证据。
- 尚缺实测证据的 1.2、2.6、5.4、6.6、7.3、8.2 仍保留下方限制和后续验收条件；未将沙箱内 kill 意图、协作退出、离线评估或纯投影测试冒充 OS 强杀、真实模型评估或人工 TTY 验收。
- 已同步新增 `local-code-mode`、`local-tool-script-contracts` 两份主规格，并向 `config-surface-settings` 追加三条 Code Mode 要求，保留既有要求；已归档到 `openspec/changes/archive/2026-10-23-add-local-code-mode/`。
- 本次归档和代码提交限定在 `feature/local-code-mode`；不合并到 `dev` 或 `main`，不推送，不改变默认关闭和实验性质。

## 当前进度

- 已创建 `feature/local-code-mode`：从 `dev` 建分支后将功能分支快进到当前 `main`，未修改 `dev` 或 `main`；当前归档与提交范围见上。
- 已固定直接依赖 `quickjs-emscripten@0.32.0`，更新 package.json 与 package-lock.json；使用临时 npm cache，未修改用户全局 npm cache 权限。
- 已接入默认关闭的配置归一化、常规页草稿/保存、三个工具的机器采集通道，以及 QuickJS 子进程、策略内派发、本地审计和分组终端展示。尚未完成全部环境及人工验收，不宣称发布就绪。
- 本轮补齐严格 IPC、资源预算、脚本位置诊断、内层 hooks/debug 归因、真实 agent-loop 策略矩阵与配置快照测试，以及非 TTY headless 回归和离线评估入口。
- 审计增加不含参数正文的形状摘要、最大身份下的终态预留、唯一结束及取消归因。Esc 同步封存已知审计和外层工具配对，异步旧回调不能影响新 turn。
- Run code 复用 Bash rail：实时审计仅重绘 footer，真实外层结果到齐后唯一追加完整终态块，预览 Result:/Logs:/Error:；结果与日志的标签及正文使用 Bash toolOutput 弱化色。覆盖真实应用逐回调、恢复、resize、主题、窄屏、控制字符及窗口逐出。不展开源码或未被脚本返回的中间正文，不切换 alternate screen；截图暴露的刷屏、旧 running 标题和结果分块已按下方记录修正，仍待可用 TTY 实测。
- 继续遵守风格整改要求，展开多语句、单行分支、复杂对象及测试；评测脚本与新增审计/渲染测试额外做了 AST 等价的格式整理，没有引入项目级 formatter 配置或依赖。
- 当前按用户决定关闭 38/38 项。用户已确认允许捕获内存分配失败，规格、模型说明、文档和正式测试已同步；旧的堆失败锁存要求不再是当前阻塞。六项仍缺实测证据的验收条件见下方表格。

## 归档后提交前验证

- 按要求依次执行 `npm run typecheck`、`npm test`、JS 语法检查：全部通过；全量 2354 项，2318 通过、36 跳过、0 失败、0 TODO，测试阶段约 76.1 秒。
- `openspec validate --all --strict --no-interactive`：84/84 通过，包含已同步主规格；归档前的变更严格验证也通过。
- 同步一致性检查确认新增的 9/6/3 条要求及其场景原文完整保留，现有配置主规格原有内容未被覆盖；`.openspec.yaml` 随变更保留。`git diff --check` 通过。
- 日志：`/tmp/echo-code-archive-{typecheck,full-tests,syntax,openspec}.log`。未因此补做真实模型、OS 信号或人工 TTY 验收，原有跳过与证据限制保留。

## 实现阶段自动化验证（标签弱化后）

按仓库要求顺序执行：

1. `npm run typecheck`：通过。
2. `npm test`：2354 项，2318 通过、36 跳过、0 失败、0 TODO，最近标签弱化修正后的测试阶段约 75.7 秒。真实墙钟 watchdog 用例等待约 30 秒后取消有限寿命的工具等待，返回 `wall_time_exceeded`，不是仅通过时钟跳变模拟超时。
3. `find bin src test scripts -name '*.js' -exec node --check {} \;`：通过。
4. `git diff --check` 与 `openspec validate add-local-code-mode --strict --no-interactive`：通过。

此前全量测试发现并修复两项原生回归：rg 无法启动时继续返回 `exitCode: null`，不将 Node 的内部错误码 `-2` 当作进程退出码。

独立评估测试：此前生命周期修正后直接执行 `node --test scripts/eval-local-code-mode.test.js`，14/14 通过；`node scripts/eval-local-code-mode.js --self-test --out /tmp/echo-code-pending-offline-final` 的 9 任务 × 3 组共 27 个 case 通过。最近仅标签弱化，未再次运行独立评估。它们使用 scripted provider 和真实工具链，不是模型性能证据，token 不伪造为 0。评估必须显式 `--allow-real-model` 才能产生真实 API 请求；本轮未执行真实模型评估。

最近标签弱化的验证日志：`/tmp/echo-code-label-dim-{typecheck,full-tests,syntax}.log`。此前生命周期修正日志：`/tmp/echo-code-pending-{typecheck,full-tests,syntax,eval-tests,offline}.log`；离线原始报告：`/tmp/echo-code-pending-offline-final/report.json`。更早日志仍在 `/tmp/echo-code-rail-full-tests.log`、`/tmp/echo-code-rail-eval-tests.log` 和 `/tmp/echo-code-rail-offline-final/report.json`。这些临时路径不属于仓库发布物，关键结论在本文件保留。

新增契约测试此前曾挂住：强制取消用例启动了无自然退出条件的假 rg，而当前命令沙箱拒绝发送信号，测试用例超时不会回收子进程。已给 fixture 添加有限寿命，并用有限寿命探针识别信号权限；不再运行旧的无限 fixture。

3 项采集限额测试现在执行真实有限进程及数据采集，仅在测试中记录终止请求，让 fixture 自然退出；已验证条数/字节预算、完整项与原生投影，以及每次投影只采集一次。没有添加生产测试参数、修改限额或放宽沙箱。此方式验证数据边界与终止意图，不能证明实际 SIGTERM/SIGKILL 生效。

4 项 rg 实际取消测试，以及 QuickJS 强杀、真实 loop 信号中断和 headless SIGTERM 各 1 项仍明确跳过。新增协作取消用例不跳过，覆盖实际 QuickJS/IPC、两路活动工具与排队取消、未 await、迟到回调隔离、Esc 配对，以及 headless 信号控制器事件；后者不是 OS 信号测试。全库其余平台/环境跳过项保留原有原因。

## Run code 亮度与间距修正（历史，最新行为以下节截图修正为准）

- 用户 rebuild 后的实际调用确认可执行，但发现整块 dim、标题不明显且下一条消息紧贴；只读投影复现了所有行无条件 dim 和块尾仅一个换行，先前自动化未断言这些视觉层级与间距要求。
- 本次仅修改渲染实现：标题复用普通工具状态 marker 配色，正文及错误不再整体 dim，仅耗时、辅助说明弱化；使用对应 text/toolError/toolOutput 主题 token。
- 活动进度仅续行，终态与非活动历史恢复块使用普通工具的单空行块尾；重复回调和无新增展示的外层结果不追加标题或空白。独立工具对、恢复重放和 AppRenderer 流式衔接共用该约定。
- 新增 8 项回归；渲染测试与审计投影共 501 项全部通过，日志 `/tmp/echo-code-render-style-tests.log`。主题测试由 notice 改为正文 text token；错误、极窄宽度和控制字符回归继续通过。
- 未修改执行器、权限、guest 预算或 provider 协议。当前进程已加载的 renderer 需重启 TUI 才使用新构建；本环境 PTY 再次返回 `out of pty devices`，没有将纯投影/控制器测试冒充人工交互验收。

## Run code rail 与真实结果预览（历史，最新行为以下节截图修正为准）

- 用户确认采用 Bash rail，并指出实际返回给 agent 的内容不可见。此前 `acceptOuterResult` 仅提取计数和诊断，本轮增加独立的有界外层结果预览；没有修改执行器、权限、预算或 provider 协议。
- pending、执行摘要和完成结果均使用 `renderToolRailRows`，不再混用树枝与细竖线。标题/状态 rail 沿用 Bash 的语义配色，正常结果不整体 dim，错误为正常亮度的 toolError，耗时及辅助说明弱化。
- `Result → agent`、`Logs → agent`、`Error → agent` 从真实外层字段生成 JSON 预览，空日志单独说明，成功时不展开 null 错误。JSON 对 C0/C1/DEL 转义以保留数据含义，不执行控制符或修改 provider/持久化事实。
- 每节缓存最多 12 个逻辑行且 4096 字符，绘制时正文再限 12 个物理行。展示裁剪明确标注 `preview truncated for display; agent response unchanged`；真实 `logs_truncated` 另行提示，数据中的 has_more/truncated 原值保留。旧记录过深/过多节点或缺失有效外层字段时只让本地预览不可用，不伪造返回数据或影响其他消息。
- 外层结果预览独立于审计终态去重：审计 end 先到后，外层仍补充一次预览；重复结果、恢复/resize、窗口切换与缓存逐出均有回归。共享 rail 的极窄宽度降级预留正文空间，安全宽度不重复扣减，无法容纳的字形安全省略。
- 本轮增加 16 项测试；渲染测试与审计投影共 517 项全部通过，日志 `/tmp/echo-code-rail-target-tests.log`。覆盖真实 result/logs/error、primitive/null、每节 12 行边界、长单行物理换行、截断区别、控制字符转义、历史 JSON 复杂度、Bash/Run code 的 1–8 列和 provider/持久化不变。
- 本轮真实 `run_code` 示例调用通过：attempted/completed 均为 2，failed/cancelled 为 0，耗时 179ms；返回包名、1.5.1 版本、6 个 Code Mode 源文件计数与两个示例路径，一条日志，未截断且 error 为 null。较早批量读取规格的调用曾触发最终返回值 16 KiB 上限并受控失败，后改用原生读取；没有为该调用调整执行限制。
- 已将该实际外层响应交给新构建的 renderer 生成纯投影，证据 `/tmp/echo-code-rail-response.json`、`/tmp/echo-code-rail-preview.txt`、`/tmp/echo-code-rail-preview.ansi`。这是真实结果的投影验证，不是交互 TTY 验收；当前运行进程不热加载 renderer，仍须重启查看新工具块。本轮 PTY 重探仍为 `out of pty devices`，8.2 保持未勾选。

## 截图反馈后的真实渲染生命周期修正（本轮）

- 用户的 `下载.png` 来自后续实际成功调用：审计每次回调都把标题和计数写进不可变历史，完成后仍留下 running 标题；审计 end 和稍后的外层结果又形成两个块。此前只验证最终响应的纯投影，未捕获逐回调 AppRenderer 的稳定历史写入，不能据此声称实际界面已通过。
- 截图中的 `preview truncated for display; agent response unchanged` 表示 UI 预览确实被截断；此前“未截断”的表达只适用于返回数据，不能用它否认展示截断。现保留每节 12 逻辑行/4096 字符缓存、12 物理正文行及明确提示，不调整运行时限额。
- 审计 start/call_start/call_end/end 仅更新有界事实并重绘 footer；单工具 TurnContext pending 保留真实 callId，进度不得借用无关运行。审计 end 到真实外层结果之间显示 finishing，已结束审计中的未完成子项记为 unfinished，不再误称活动 pending。
- 真实外层结果到齐后，历史唯一追加完整 rail：终态标题、按序子调用、一份计数摘要、实际 result/logs/error 预览及块尾一行空白。成功审计的通用结束诊断不重复显示计数；重复事件、外层结果及后续 assistant 输出不再重复工具块。
- 标签改为 `Result:`、`Logs:`、`Error:`；结果/日志正文遵从用户最新要求，使用与 Bash 相同的 toolOutput 弱化色且不额外叠加 ANSI dim。标题、进度保持正常亮度，错误正文使用 toolError。此要求取代上轮“结果正文正常亮度”及箭头标签的选择。
- 活动 resize 先重建当前窗口的脚本事实，再绘制 footer，不提前提交终态；也覆盖审计结束但尚无外层结果的 legacy active 快照。非活动残缺历史仍明确显示 interrupted/unfinished 或预览不可用；主窗口/BTW 缓存隔离，逐出释放旧事实。
- 新增 9 项回归，并更新既有断言；真实 AppRenderer/footer append 边界和公开 runAssistantTurn/AppContext/TurnContext 组合验证每次回调的稳定正文为空、footer 进度正确、最终仅一块。未添加仅供测试的生产分支。渲染、审计 transcript、全部 app/commands 定向测试 1128/1128 通过，日志 `/tmp/echo-code-pending-target-tests.log`；全量结果见上。
- 未更改执行器、安全边界、资源预算、审计持久化或 provider 过滤。只读复查未发现阻塞；该轮 PTY 探针仍返回 `out of pty devices`，未将控制器测试冒充人工交互验收。当前进程缓存 renderer 模块，必须重启 TUI 后才能观察新构建；当时 8.2 和其他五项环境/授权验收仍未完成，现按上方归档决定关闭流程，实测缺口不变。

## Result/Logs 标签弱化（最新）

- 用户再次实际调用 run_code 成功：两个内部工具全部成功、160ms，返回结果和一条日志；随后要求 `Result:` 和 `Logs:` 标签也弱化。本次让这两个标签与各自正文共用 toolOutput 色，不额外叠加 ANSI dim；`Error:` 标签及错误正文仍使用正常亮度的 toolError。该要求取代上一节“各节标题保持正常亮度”的选择。
- 更新自定义主题回归：对不同的 text/toolOutput/toolError RGB 明确断言两个标签使用输出色、错误标签使用错误色，不能仅靠“没有 ANSI dim”推断颜色正确。未改变 footer/唯一最终块生命周期、返回数据或缓存预算。
- 已重新按顺序通过类型检查、2354 项全量测试和 JS 语法检查，结果见上；规格和文档同步更新。该轮未完成助手侧人工 TTY 验收，未提交、推送或归档；当前归档及提交决定见上，环境/授权实测缺口未被改写。

## 用户确认后的内存策略

在生产执行路径中运行以下有限脚本（没有无限循环或超额成功分配）：

```javascript
try {
  new ArrayBuffer(64 * 1024 * 1024);
} catch {}
await tools.glob({pattern: '*'});
return true;
```

历史复现结果为 `status: succeeded`、`result: true`、宿主派发 1 次。32 MiB 堆限制阻止了分配本身，但脚本捕获错误后仍可继续；当时不符合旧规格的全局预算致命锁存要求，但不等于越过堆上限或获取了白名单外能力。

固定版本的公开 runtime/FFI 有内存上限和当前使用量 API，但未找到可可靠观察“曾发生过且被 guest 捕获的分配失败”的锁存接口。当前堆用量/定时采样不能替代该保证，也不以包装单个 ArrayBuffer 构造器冒充覆盖所有内部分配。

用户随后明确确认保留现成 QuickJS，不定制/分叉/重编 WASM 或更换引擎来实现该锁存。当前规格允许捕获分配失败后继续受原有权限和预算约束，不承诺报告已捕获的历史 OOM；未捕获时仍以 `memory_limit_exceeded` 失败。其他不可恢复限额和取消仍永久关闭派发；日志仍有界截断。

旧的失败 TODO 已移除，改为普通通过的回归：连续两次 64 MiB 分配均被拒绝后，脚本可以调用一次只读工具；捕获内存异常不能恢复此前因参数限额关闭的派发。未捕获 OOM 失败和下一次全新执行的隔离回归保留。4.3 按确认后的规格完成；1.2 的实际父进程强杀验收仍缺证据，仅按归档决定关闭任务。

## npm pack 与安装冒烟

- `npm pack` 正常执行现有 prepack/tsc 构建，产物安装到全新临时 prefix，未使用项目 node_modules 代替安装依赖；HOME 与 npm cache 均隔离到临时目录。
- macOS arm64、Node v24.2.0：已安装包能加载 CommonJS/WASM、完成异步工具桥接、返回正确 JSON，guest 的 `process` 不可见，审计顺序正确，CLI `--version` 退出码 0。
- 同一已安装产物在 Node v20.3.1：可信初始化及独立脚本执行通过，`process`/`require` 均不可见。
- 上轮源码（本次渲染样式修正前）重新 pack 并全新安装后，在上述两个 Node 版本均验证超额分配被拒绝、捕获后异步工具调用成功及四个审计事件顺序正确。临时探针首次误用了不存在的 `scriptSuccess` 导出；修正为公开 v1 envelope 后两版均通过，没有因此修改生产代码。本次未重跑安装包冒烟。
- 该轮证据：`/tmp/echo-code-mode-pack-latest.pGcikN/{pack.json,pack.log,install.log,probe.cjs,smoke.json,smoke-node20.json}`；早期记录保留于 `/tmp/echo-code-mode-pack.RPSx65/`。
- 该轮临时安装使用的 npm 提示项目 postinstall 与 sharp install 未被其 allowScripts 策略批准；加载与桥接冒烟不等同于验证这些安装脚本或多媒体功能。
- 未验证 Linux、Windows、其他 CPU 架构；不声称跨平台运行验收通过，也未验证 Node 子进程总 RSS 上限。

## 隔离运行时前置检查

临时独立进程探针分别在当前 Node v24.2.0 和 npm 提供的 Node v20.3.1 上执行，结果如下：

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| CommonJS 加载 QuickJS/WASM | 通过 | macOS arm64；后续 npm pack 安装结果见上，其他平台未验证 |
| 宿主异步结果经 deferred Promise 返回 guest | 通过 | 手动执行 pending jobs 后得到预期数值 |
| 计算中断 | 通过 | 无限循环在 interrupt handler 截止条件下返回错误 |
| Guest 内存上限 | 通过当前策略 | 32 MiB 限额下超额分配被拒绝；捕获后可继续，未捕获时失败，不要求历史 OOM 锁存 |
| 基础宿主能力不可见 | 通过 | guest 中 process、require、fetch、Buffer、WebAssembly 及 Function 构造得到的全局 process 均为 undefined；不是完整逃逸测试的替代 |
| 沙箱内探针父进程强制终止 | 失败 | 两个 Node 版本向自建 child 发送 SIGKILL 均返回 `kill EPERM`；不是外层 Echo 主进程的终止测试 |

后续检查定位到明确的规则问题：`src/sandbox/macos-seatbelt.ts:109–122` 生成的 profile 使用 `(deny default)`，放行 `process*`，但未放行独立的 `signal` 操作。系统自带 profile 中可见独立的 `(allow signal (target children))`、`(allow signal (target same-sandbox))` 规则。现有 `test/sandbox/seatbelt-execution.test.js:25–34` 也已明确记录沙箱化 shell 可能拒绝 kill，并据此跳过终止测试。这些证据与探针的 EPERM 一致；未获取内核拒绝日志，也未在外层宿主执行对照测试。

前一次结论混淆了执行层级：探针父进程由 `run_bash_command` 启动，本身就在命令沙箱内；它不是位于命令沙箱外的 Echo 主进程。现有 `src/tools/bash-command-runner.ts:54–66` 只包装子命令，`103–123` 则由宿主发送终止信号。故此次失败不能判定 Echo 主进程无法终止受管理子进程，也不构成必须关闭或放宽沙箱的证据。生产架构的强制终止能力仍待正确层级的验证，不提前标记通过，不用 guest 自行退出代替强制清理。

## 尚缺实测证据与后续验收条件（任务已按用户决定关闭）

| 原验收任务 | 当前覆盖与缺口 |
| --- | --- |
| 1.2 | 引擎加载、异步、内存、累计计算及能力不可见已验证；外层宿主实际强杀尚未验证。 |
| 2.6 | AbortSignal、文本 stream 关闭及原生兼容回归通过；rg 实际终止和升级强杀仍需允许信号的宿主环境。 |
| 5.4 | 协作取消、真实墙钟 watchdog、750ms 强杀后备和迟到隔离已实现并覆盖可执行部分；不能用自然退出冒充强杀验证。 |
| 6.6 | 非 TTY 成功/失败及信号控制器协作清理通过，无 session/stdin/raw mode；实际 OS SIGTERM 路径仍跳过。 |
| 7.3 | 真实模型与 API 预算尚未获确认，未发送真实模型请求。离线通过不作为模型收益结论。 |
| 8.2 | 重新探测 PTY 仍报 `out of pty devices`；不能完成 `npm start` 下的人工交互检查。配置页原本无鼠标处理，本次不新增或宣称鼠标能力。 |

- 在命令沙箱外、保持既有沙箱规则的真实宿主终端复跑相关自动化信号测试，并验证实际进程资源释放；不要把 Bash 沙箱内探针权限当成 Echo 宿主权限，不通过关闭或放宽沙箱解决。
- 在可用 TTY 按 AGENTS.md 完成输入、流式/工具展示、footer/resize、模式/审批、slash、配置草稿/保存/放弃和 Esc/退出清理检查，再记录结果。
- 真实模型评估须另行确认明确的 model profile、模型版本、任务/重复次数及 API 预算；不会自行调用。
- npm 安装报告 8 项依赖树漏洞（3 moderate、4 high、1 critical），尚未完成来源核对，不声称由新增依赖造成或已修复；不自动运行 audit fix 或更新无关依赖。
- 用户已授权在当前功能分支归档并提交；保持默认关闭与实验性质，不合并或推送，任务的流程关闭不代表上述实测缺口已通过。
