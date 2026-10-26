## 1. 配置模型与旧字段停读

- [x] 1.1 增加主 Agent `disabledTools` 配置类型及独立解析，缺失默认 `[]`，不再读取旧 mode 或据此推导名单；明确精确名称匹配、Bash 强制开启、Todo 任一单项禁用归一化为成对禁用、去重和未知名称保留。
- [x] 1.2 增加配置 snapshot 的工具偏好／草稿读取和分域原子保存，严格报告非法新字段；保存只更新 `tools.mainAgent.disabledTools` 并保留其他节点。
- [x] 1.3 完全移除旧 `tools.fileEdit.mode` 读取及内部 `fileEditMode`、`includeBothFileEditTools`，不为子运行保留互斥兼容策略；旧 JSON 字段可作为未识别数据保留但不主动清理，常规保存只写本页字段。
- [x] 1.4 补充配置测试：缺失名单与显式空数组均默认全开、旧两种 mode 及非法旧 mode 均无效、旧字段不影响有效新名单、非法新名单、Bash 禁用尝试、Todo 成对启停及两种单项禁用归一化、重复及未知名称、只读不迁移写盘和分域保存保留旧字段及未知数据。

## 2. 工具目录及主／子运行装配

- [x] 2.1 保留 `main-agent-tool-catalog`，使工具页能够获得未筛选的工具候选名称与可用性，包括独立编辑工具、特殊工具、资源工具和已发现 MCP tools；由 UI 投影中文短说明，将启用偏好与当前可用性分开。
- [x] 2.2 公共工具工厂始终构造两个编辑候选，主运行在合并可用 MCP tools 后应用 `disabledTools`，子运行按自身 `allowedToolNames` 筛选，使 provider definitions 和 executor 共享最终 registry；避免关闭工具后无法重新列举。
- [x] 2.3 明确主运行与子运行装配入口，禁止把主禁用名单无条件放入公共工厂或传给子运行；Worker 的 definition 仅保留 `apply_patch`，不暴露或执行 `edit_file`，Explorer 仍无编辑工具，自定义 Agent 继续自身白名单，不再读取旧 mode。
- [x] 2.4 补充 registry 测试：缺失名单默认双编辑工具、仅 Bash、两个编辑工具的四种组合、Todo definitions 和 handler 必须成对存在或缺失、MCP 精确禁用、资源不可用、候选目录重新启用、未知工具不会注册及主／子运行隔离（Worker 仅 apply_patch、Explorer 无编辑、自定义白名单不扩张）。
- [x] 2.5 按 review 清理目录执行器装配、原始 description 和仅为元数据共享增加的工厂／导出；直接引用已有工具名常量，测试目录名称集合与真实 registry 一致且不读取文件或技能目录。

- [x] 2.6 按本次确认从内置 Worker definition 移除 `edit_file`，保留 `apply_patch`；回归验证 schema／handler 均被筛除，伪造调用在审批前拒绝，主 Agent、自定义 Agent、Explorer 和共享工厂保持原策略，并同步直接相关文档与规格。

## 3. 调用执行边界与请求材料

- [x] 3.1 在主 loop 处理 Todo、提问、委派、风险审批及 executor 前校验最终 registry 成员资格；禁用或未知调用返回匹配身份的失败 tool result。
- [x] 3.2 验证普通及并行调用中的禁用检查均不会触发 Todo 状态变更、user-question callback、审批、change recorder、handler 或子运行。
- [x] 3.3 使自动提示材料与最终 registry 一致，禁用 `use_skill` 时不自动注入依赖其调用的 Skill 目录，同时保留子运行派生 scope 所需父 Skill snapshot。
- [x] 3.4 保持单次运行及全部 continuation 的工具快照，接入共享配置刷新与 schema 变化的 context usage 失效，不改变历史 tool records 或追加设置 transcript。
- [x] 3.5 补充执行测试：伪造禁用调用、特殊工具分支、并行调用、授权缓存与 `--full-access` 不覆盖禁用、normal/plan/readonly 叠加、运行期间配置变化及 Skill scope 隔离。

## 4. 配置工具页

- [x] 4.1 新增“工具”Tab 及独立草稿／选择状态，按内置工具和 MCP server 展示真实名称、说明、开关与可用性；将两个 Todo 工具投影为一个联动项，标注主 Agent 作用域，配置文档说明非安全权限语义。
- [x] 4.2 支持 Space／Enter 切换、Bash 锁定、显式保存、完整列表滚动及 footer 宽高预算；保留离线 MCP 禁用偏好，不为展示目录主动建立连接。
- [x] 4.3 移除常规页文件编辑方式行，将工具页接入 Tab 循环、跨 Tab 状态保留、读取错误隔离、独立保存和统一放弃草稿保护。
- [x] 4.4 补充 controller／render 测试：工具切换与两个编辑项、Todo 仅一行且成对切换／保存／重新开启、Bash 不产生 dirty、重新开启禁用项、跨 Tab 草稿、离线项、错误隔离、保存反馈和窄小终端完整列表访问。
- [x] 4.5 按截图反馈精简工具页：移除顶部策略说明和底部详情 hint，使用右对齐中文短说明；内置标题移除“未知项”，缺少定义的保留偏好按需单独分组，并补充回归测试。
- [x] 4.6 按 review 删除草稿 getter 的重复断言及 UI 初始化重复归一化，按 Tab 同名字段取状态并删除重复映射；保留配置读取、保存、运行入口校验，验证草稿隔离及五个 Tab 的错误状态投影。

## 5. Provider、Headless 与文档

- [x] 5.1 验证 OpenAI Responses、OpenAI Chat、Anthropic、Codex 只转换最终 definitions，支持零个、一个或两个编辑 schema，历史 call/result 转换保持不变。
- [x] 5.2 增加 TUI 和 `--once` 共用配置的集成测试，覆盖 Todo 单项禁用被补全且两种调用均被拒绝、默认 deny、显式 full-access、只读旁路及下一次运行生效；模拟 provider 测试只声明配置和执行通路保证。
- [x] 5.3 更新配置和工具说明文档，说明新字段缺失默认 `[]`、双编辑工具及其他可用工具默认开启、Todo 合并显示与成对持久化、手写单项禁用归一化、显式空数组、新增工具默认开启、旧 mode 不再读取且不迁移／清理、subagent 自身白名单独立及回退旧版本会忽略禁用名单。
- [x] 5.4 按已确认的清理范围同步 README、配置／架构文档及本 change 的 proposal、design、tasks、增量规格：公共工厂始终构造双编辑工具、主禁用名单与子白名单独立筛选，保留未过滤候选目录；移除旧读取兼容和默认仅 `apply_patch` 的要求，不改历史归档。

## 6. 验证与人工检查

- [x] 6.1 运行 `openspec validate configure-main-agent-tools --strict`，确认本变更 artifacts 与增量规格格式有效；该命令不替代实现测试或交互验证。
- [x] 6.2 按顺序运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 6.3 按用户归档收尾要求关闭，本环境未实际执行，不代表验证通过。原计划：启动 `npm start`，人工验证工具 Tab、跨页草稿保护、Bash 锁定、Todo 单项展示与成对启停、两个编辑开关的全部组合、保存后下一轮生效、列表滚动、resize、Esc 和退出清理。
- [x] 6.4 按用户归档收尾要求关闭，本环境未实际执行，不代表验证通过。原计划：人工验证现有输入编辑、换行／提交、streaming、Markdown／工具渲染、footer、slash／模式／本地操作及审批／提问／Subagent 流程未回归；有 MCP 环境时验证单工具关闭且连接保持。
- [x] 6.5 使用 fake agent 验证非 TTY `--once`、配置失败退出码、默认工具拒绝与显式 `--full-access`，并记录无法完成的真实 provider 或终端环境验证项。

## 验证记录

以下先列此前实现／review 阶段记录，后续调整的验证结果分别列于末尾各节；自动化与 CLI 验证均不代表完成了真实终端交互验证。

- review 简化后重新按顺序通过类型检查、完整测试和 JavaScript 语法检查；完整测试共 2237 项，2208 通过、29 跳过、0 失败。OpenSpec 严格校验与 `git diff --check` 通过。
- 已在隔离临时 HOME 下执行真实非 TTY CLI：fake `--once` 及 `--once --full-access` 均输出预期纯文本；手写单 Todo 禁用不触发配置迁移写盘；非法名单及模型配置错误均退出 1，stdout 为空且不等待 stdin。
- 普通工具默认拒绝、显式 full-access 放行及禁用工具不被重新授予，由使用真实 `runOnce`／registry／executor 的受控 provider 集成测试覆盖；模拟输出仅验证程序通路，不宣称真实模型会选择同样工具。
- 6.3、6.4 尚未完成：尝试创建 PTY 时环境返回 `OSError: out of pty devices`，未能启动真实交互按键验证。工具 controller、渲染宽高预算、草稿保护等已有自动化覆盖，但不能替代人工观感、resize 和终端清理确认。真实 provider／在线 MCP 验证也尚未执行，留待具备终端和服务配置的环境补验。
- 本轮已通过真实工具目录生成并检查精简后的渲染输出，新增测试覆盖中文短说明、右对齐、按需未识别分组及释放说明行后的列表预算。再次探测 PTY 返回 `[Errno 1] Operation not permitted`，上述交互人工检查仍保留为未完成。
- review 简化新增测试覆盖工具目录零文件／目录读取、与真实完整 registry 的名称集合一致、五个 Tab 的独立错误投影，以及已归一化工具草稿的深复制隔离；移除对原始模型 description 一致性的无用途约束。读取、保存和运行入口的名单校验及主／子 Agent 隔离测试仍通过。

### 本次移除旧编辑模式

- 已停止读取旧 `tools.fileEdit.mode`，删除内部 `fileEditMode` 类型／派生字段及 `includeBothFileEditTools`；公共工厂始终构造两个编辑工具，缺失主禁用名单默认 `[]`，子运行继续自身白名单。保留配置页候选目录及旧 JSON 数据，不迁移或主动清理。
- 已更新配置、provider、主／子运行、UI 默认值及相关 fixture 测试；同步直接相关文档和当前 change，并补充 Worker 增量规格。未修改基线规格或历史归档，未 commit／merge／archive。
- 最终按顺序通过 `npm run typecheck`、`npm test`、JavaScript 语法检查；完整测试 2237 项，2208 通过、29 跳过、0 失败。`openspec validate configure-main-agent-tools --strict` 与 `git diff --check` 通过。最终全量日志：`/tmp/echo-main-tools-remove-legacy-validation.log`。
- 首次全套复验的 `glob applies the default output budget without retaining a partial path` 失败，单独重跑及完整序列重跑均通过；未修改该测试或 glob 实现，失败原因尚未确认。首次日志：`/tmp/echo-main-tools-remove-legacy-test.log`。
- 隔离临时 HOME，使用真实非 TTY CLI 和 fake provider，分别以旧 mode 为 `apply_patch`、`edit_file`、非法值执行普通 `--once` 与 `--once --full-access`，均退出 0、输出预期纯文本、stderr 为空，配置文件内容不变。fake provider 不产生工具调用；执行准入与审批由前述集成测试覆盖。
- 6.3／6.4 继续保持未勾选；真实终端交互、真实 provider 及在线 MCP 本次未验证。

### Worker 仅使用 apply_patch

- 仅从内置 Worker 的 `WORKER_LOCAL_TOOL_NAMES` 删除 `edit_file`；共享工厂仍提供双编辑候选，主 Agent 独立开关、Explorer 及自定义 Agent 的工具策略不变。
- 回归测试验证 Worker schema 与 handler 仅保留 `apply_patch`，伪造的 `edit_file` 调用返回匹配身份的失败结果且不请求审批；同时保留主禁用名单不继承、独立 Todo 及禁止嵌套委派的覆盖。同步命令 fixture、用户文档和本 change 的相关规格。
- 按顺序通过类型检查、完整测试及 JavaScript 语法检查；2237 项中 2208 通过、29 跳过、0 失败。OpenSpec 严格校验及 `git diff --check` 通过。完整测试日志：`/tmp/echo-worker-apply-patch-only-test.log`。
- 6.3／6.4 仍未完成，未重新执行真实终端交互、真实 provider 或在线 MCP 验证；未 commit／merge／archive。

### 归档收尾

- 按用户明确要求将全部任务勾选关闭；6.3／6.4 为收尾关闭而非实际验证通过，前述 PTY 限制和真实终端／provider／在线 MCP 验证边界仍然存在。
- 历史回读提示已简化为 `If more details are needed, read source_file with pagination.`，不指定工具或以专用只读工具可用性作为前提；对应回归测试、类型检查、完整测试及 JavaScript 语法检查通过，日志为 `/tmp/echo-source-history-read-hint-test.log`。
- 用户确认同步增量规格至主规格后归档，并将工作区新增的 8 条模型窗口记录一并提交；本次收尾不使用 subagent，不推送远端。
- 已同步主规格并归档；合并前再次按顺序通过类型检查、完整测试和 JavaScript 语法检查，2237 项中 2208 通过、29 跳过、0 失败。六项相关主规格严格校验及 `git diff --check` 通过；完整测试日志为 `/tmp/echo-main-tools-pre-merge-test.log`。
