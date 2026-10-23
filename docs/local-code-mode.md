# 本地 Code Mode（实验功能）

Code Mode 让模型用一段普通 JavaScript 编排本地只读查询，最后只返回选中的数据，减少跨文件任务中进入上下文的中间正文。**默认关闭，不替换原生工具，不是新的 `/mode`。** 简单查询通常直接使用原生工具即可。没有证据表明所有模型都能因此提高成功率或降低成本，也不根据模型名称自动开启。

> 当前功能仍处于实验验收阶段。内存策略保留 QuickJS 的现成语义：32 MiB 堆限制拒绝超额分配，但允许脚本捕获分配错误后继续受限执行；未捕获的内存错误使执行失败。其他不可恢复限额和取消仍关闭派发。不能将配置开启当成完整安全验收通过，真实宿主强制终止、交互验收与真实模型评估的覆盖范围以变更验证记录为准。

## 开启、保存与关闭

1. 输入 `/config`，进入“常规”Tab，选中 **Code Mode**。
2. Enter、Left、Right 切换的是草稿；跨 Tab 保留，未保存关闭会询问是否放弃。
3. 激活“保存常规设置”才写入配置。保存成功保持设置页打开；失败保留草稿。
4. **下一次 assistant run 生效**，不会在执行中的一轮增删工具或中断脚本。修改配置文件后的 watcher 刷新遵守相同规则。

也可合并到 `~/.echo/config.json`，保留已有的其他字段：

```json
{
  "tools": {
    "codeMode": {
      "enabled": true
    }
  }
}
```

设为 `false` 关闭；缺失或非 boolean 同样按关闭处理。TUI 主对话和 `--once` 使用同一字段；没有新增专用 CLI 开关或 slash command。子 Agent 不自动继承 `run_code`。

开启是配置意图，不代表运行时一定就绪。QuickJS/WASM 无法初始化时隐藏 `run_code`，提示一次本地说明，原生工具仍可用；已收到的显式调用返回 `runtime_unavailable`。**绝不回退到 `node:vm`、Node `eval` 或普通宿主代码执行**，也不自动把已保存的开关改回关闭。

关闭不删除旧的执行摘要。恢复、分叉会话只读取历史，不重跑脚本。正在执行的脚本仍使用原 snapshot；需要立即停止时用 Esc。

## 能力及边界

调用输入只有 `{ "code": "..." }`。`code` 是单次 **async function 的函数体**，直接使用 `await` 和 `return`，不是函数声明或 TypeScript 源码。

只暴露以下方法和有界 `console.log/warn/error`：

| 方法 | 输入 | 成功数据 |
| --- | --- | --- |
| `tools.glob` | `{pattern, paths?}` | `{paths, has_more}` |
| `tools.grep` | `{pattern, paths?, glob?, literal?, case_sensitive?}` | `{matches, has_more}` |
| `tools.read_files` | `{files: [{path, offset?, limit?}]}` | `{files: [...]}`，仅普通 UTF-8 文本 |

`paths` 缺省或 `null` 使用固定的本次工作目录；`literal` 缺省或 `null` 为 `true`，设为 `false` 使用正则；`case_sensitive` 缺省或 `null` 沿用 ripgrep 默认行为。`offset` 缺省或 `null` 为 0，`limit` 缺省或 `null` 读取剩余行但仍受预算限制。参数拒绝未声明字段，不能传任意工具名或用动态分派提升权限。

- 白名单还须与本次实际允许的工具集合取交集；外层获准不代表内层自动获准。
- normal、plan、readonly、headless 继续使用原有策略。`--full-access`、自动审批和会话 allow-all **均不扩张脚本白名单**。
- Bash、写文件/编辑、MCP、网络工具、用户问题、子 Agent、递归 `run_code` 都不可从脚本调用。没有 `process`、`require`、`Buffer`、环境变量、直接文件/网络/进程 API、任意 import、npm 包或宿主对象。
- 每次独立 QuickJS/WASM context 和受管理子进程；没有持久化 REPL、跨调用变量/结果句柄、定时任务或后台执行。子进程本身不是隔离保证，不能以“开了子进程”代替无宿主能力和 JSON 桥接。
- 路径沿用原生工具边界：**不是所有读取都限制在 workspace 内**，绝对路径及 `..` 可能合法；`.git` 保持排除规则。只读仍可能读取敏感内容，请仅在信任项目与模型服务时启用。文件内容是不可信数据，不能授权更多能力。
- 图片、PDF、目录和特殊文件在脚本读取分派前拒绝；非 UTF-8、二进制文件失败，不解码图片或提取 PDF。需要这些能力时改用原生工具，而不是扩大脚本权限。

## 版本化契约、分页与截断

真实输入/输出 schema 和生成的精简说明维护于 `src/tools/code-mode/contracts.ts`；工具说明由契约生成，不从展示样本推断。脚本消费实际采集的数据，**不解析 ANSI、展示行号或 UI 的 `details.display`**。

三个方法统一返回 v1 envelope：

```json
{
  "schema_version": 1,
  "ok": true,
  "data": {"paths": [], "has_more": false},
  "error": null,
  "truncated": false
}
```

失败的 `error` 为 `{code, message}`，通常 `data: null`。批量读文件部分失败例外：顶层 `ok: false`、`error.code: "partial_failure"`，**仍保留按请求顺序排列的 `data.files` 成功项和失败项**。逐项失败形如 `{path, ok:false, kind:"error", error}`。无匹配是成功空列表，不是工具失败。

`grep` 每个匹配为 `{path, line, column, text}`：`line` 从 1 开始，`column` 是 **1-based UTF-8 字节列**，不是 JS 字符下标、Unicode 码点或屏幕列。例如 `中文🙂 needle` 中 `needle` 的 column 为 12。`text` 为完整保留的源行，不含展示前缀。

文本成功项字段：

```text
path, ok:true, kind:"text", content,
offset, returned_lines, start_line, end_line,
has_more, content_truncated, next_offset, total_lines?
```

- `content` 为 LF 归一化内容，不承诺逐字节保留 CRLF/CR；不含展示行号。
- `offset` 是从零开始跳过的源行数；`start_line/end_line` 为真实 1-based 行号。空文件或越过 EOF 返回 `content:""`、0 行、范围和 `next_offset` 为 `null`。
- 只有完整扫描到 EOF 才提供 `total_lines`。仅因为请求的 `limit` 停止，使用 `has_more:true` 与可靠的 `next_offset`，**不会单凭正常分页设置 `truncated:true`**。
- 字节/JSON 预算裁减会设置 `truncated:true`；文件项同时标记 `content_truncated`。保留完整行时可给出行边界的 `next_offset`；**末行只返回一部分时 `next_offset:null`，不能跳过剩余字节**。
- JSON 预算可能连一整行也装不下，返回 0 行且保留原 offset。这不表示已经取得进展，重复同一请求可能永远无法前进。不能虚构字节游标；改用原生工具或缩小任务。`content_truncated` 不单独说明是否保留过部分行。
- `glob/grep` 的 `has_more` 表示集合仍有或可能有后续项；条数/字节截断只保留完整路径/匹配项。没有通用 cursor 或已知总数，须缩小 `paths`、`pattern` 或 `glob`，不能用一个 capped 列表计算全量统计。

### 示例：跨文件查询

以下是 `code` 字段的内容：

```javascript
const files = await tools.glob({pattern: "src/**/*.ts"});
if (!files.ok) return {error: files.error};
if (!files.data.paths.length) {
  return {matches: [], incomplete: files.data.has_more};
}
const found = await tools.grep({pattern: "TODO", paths: files.data.paths});
if (!found.ok) return {error: found.error};
return {
  matches: found.data.matches,
  incomplete: files.data.has_more || found.data.has_more
};
```

### 示例：检查部分失败和安全分页

```javascript
const first = await tools.read_files({
  files: [{path: "README.md", offset: 0, limit: 20}, {path: "missing.txt"}]
});
if (!first.data) return {error: first.error};
const errors = first.data.files.filter(file => !file.ok);
const file = first.data.files[0];
if (!file.ok) return {errors};
if (file.has_more && file.next_offset === null) {
  return {errors, incomplete: true, reason: "不能按行续读部分源行"};
}
return {
  errors,
  preview: file.content,
  incomplete: file.has_more,
  nextOffset: file.next_offset
};
```

逐页累计时必须同时检查 `ok`、`has_more`、`next_offset` 是否可靠且前进，并控制总页数及最终值大小。不要把示例中的 preview 当完整文件。

## 固定限额

以下是每次 `run_code` 的固定上限，不是可由模型参数或用户配置调大的配额。字节均按 UTF-8/UTF-8 JSON 计算。

| 资源 | 上限 |
| --- | --- |
| 源码 / 单次 JSON 参数 | 各 32 KiB |
| Guest JS 堆 | 32 MiB，分配失败可捕获，不代表 Node 子进程总 RSS |
| 累计 guest 活跃计算 | 1,000ms，含 Promise job、最终值转换；不含等待工具 |
| 整次墙钟 | 30 秒，含排队、工具等待和收尾 |
| 内部调用尝试 | 16 次，非法和被拒绝的尝试也计数 |
| 活动宿主调用并发 | 2，其余在总调用预算内排队 |
| 单次工具完整 JSON envelope | 64 KiB |
| 累计工具响应 JSON | 512 KiB |
| 最终返回 JSON | 16 KiB，超限失败，不截断成损坏 JSON |
| 日志 | 32 条且合计 8 KiB，超出有截断标记 |
| 单条日志 | 最多 4 KiB，同时计入总日志预算 |
| 本地审计摘要 | 32 KiB，预留终态空间，不复制完整中间正文 |
| IPC 单条消息 | 256 KiB，另须满足对应参数/响应预算 |
| JSON 结构复杂度 | 深度最多 32、遍历节点/对象键数最多 4,096；不是可借此扩大字节预算 |
| 取消/超时后的强制清理 | 至多 1 秒进入强制终止流程 |

还保留原生采集上限：glob 200 路径、grep 100 匹配、read_files 每次最多 10 个文件、单文件内容默认 1,000,000 字节；脚本 64 KiB JSON 预算经常更早生效。原生工具的其他输出/媒体限额不因 Code Mode 放宽。

返回值只能是 JSON；没有显式返回归一化为 `null`。BigInt、循环引用、函数、Symbol、非有限数或不能保持 JSON 语义的值明确失败，不能依赖静默丢字段。**所有工具 Promise 都必须 await**，返回时仍有调用则 `pending_tool_calls` 失败、取消剩余工作，不允许外层结果之后继续后台执行。

## 失败、修复与可见结果

外层普通 tool result 包含：

```text
status: succeeded | failed | cancelled
result, logs, logs_truncated, summary, error
summary: attempted/completed/failed/cancelled/duration_ms
error: null 或 {code,message,phase,line?,column?}
phase: compile | runtime | tool | serialize
```

`status:succeeded` 只表示脚本执行及返回值通过运行时检查，**不表示任务答案正确**。

普通工具错误（如 `partial_failure`、`unsupported_type`、`read_failed`、`invalid_encoding`、`tool_failed`）可通过 `ok/error` 做有限分支。先读诊断再修参数，不能把失败误当无匹配。`syntax_error`、`serialization_error`、`pending_tool_calls` 等外层错误需要修改脚本；执行级契约错误、取消和不可恢复限额触发后永久关闭本次派发，不能 catch 后恢复权限。仅内存分配失败可由脚本捕获后继续，但不能提升 32 MiB 堆上限或恢复已经关闭的派发；未捕获则返回 `memory_limit_exceeded`。宿主不承诺观测已捕获的历史内存失败。日志超限继续有界截断，不因此提高其他配额。运行时不可用时改用原生工具，不寻求宿主 JS 降级。

失败不会回滚已经完成的读取，也不会自动重跑脚本。模型可以修复后新建调用或改回原生工具，修复会继续消耗时间、token 和工具预算。Esc 贯通取消队列、查询进程、文件 stream 与 guest；迟到结果不应进入下一轮。

交互界面复用 Bash 的 rail。运行进度仅在 footer 临时区域重绘，不逐事件追加到历史；审计结束但外层结果尚未到达时显示 `finishing`。收到真实外层结果后，历史只追加一个完整块：终态标题、按序子调用、一份摘要及 `Result:`、`Logs:`、`Error:` 预览，并与下一条消息留一行空白。

结果和日志的 `Result:` / `Logs:` 标签与正文均使用 Bash 输出的弱化色，执行标题保持清晰，`Error:` 标签与错误正文使用正常亮度的错误色；空日志显示 `Logs: (none)`，成功时省略 null 错误。源码和未被脚本返回的中间正文不会展开。当前 TUI 不会热加载 renderer，构建后须重启才能看到新显示。

每节预览缓存最多 12 个逻辑行且 4096 字符，正文显示最多 12 个物理行；`preview truncated for display; agent response unchanged` **仅表示界面省略**，不修改 agent 收到的响应。真实 `logs_truncated` 单独提示，返回 JSON 中的 `has_more`/`truncated` 保持原值。JSON 内的终端控制字符以转义字面量显示，不执行、不删除其数据含义。旧记录缺少有效外层结果时明确显示预览不可用。

内部 `code_execution` 记录只在本地审计、恢复/分叉中使用，排除于 provider 消息、token 投影与压缩输入。模型只接收外层返回值、日志及诊断；脚本主动返回的文件内容仍可能到达模型。`--once` 不创建会话、不等待 stdin，不输出 TUI ANSI。

## 独立配对评测

评测入口是 `scripts/eval-local-code-mode.js`，**不进入默认 `npm test`**，不安装新依赖。它复用项目编译后的 `prepareAgent`、真实 provider adapter、agent loop、执行策略及 QuickJS/工具桥接，不把 fake agent 的自报成功当模型评测。

### 离线计划与管线自测（无 API 请求）

```bash
node scripts/eval-local-code-mode.js --dry-run
# 先由主验证流程构建 dist，不要与 npm build/test 并发清写 dist
node --test scripts/eval-local-code-mode.test.js
node scripts/eval-local-code-mode.js --self-test --out /tmp/echo-code-eval-offline-new
```

`--dry-run` 不加载运行时、不读取模型配置，也不联网。自测使用确定性 scripted provider，**只验证评测机制和真实工具链，不是模型收益证据**；不会伪造 token，未报告用量记为不完整，汇总 token 为 `null`。

每个 case 新建临时目录，固定夹具与独立 expected-value 验收器，覆盖：简单 Unicode 查询、跨文件筛选、依赖分支、聚合、无匹配、空文件/部分失败、分页和长行截断、超过列表上限后的缩小查询、错误脚本修复。最终回答必须是精确 JSON，与独立写定的期望值比较；“已完成”或 `status:succeeded` 不计任务成功。夹具、验收器和离线 provider 分开维护，provider 从真实工具结果计算答案，不读取期望值。

### 真实模型：先确认模型与费用预算，再单独授权执行

**本变更的离线验证没有调用真实模型。** 真实评测不应在 CI 或默认测试中隐式执行。复制并修改 `scripts/eval-local-code-mode/settings.example.json`：

```json
{
  "mode": "real",
  "configPath": "/absolute/path/to/.echo/config.json",
  "modelProfileId": "your-profile-id",
  "model": "exact-model-version-from-that-profile",
  "effort": "none",
  "repeats": 1,
  "groups": ["native", "optional"],
  "budgets": {"turns": 12, "tools": 48, "tokens": 64000, "wallMs": 120000}
}
```

路径必须实际可读（不展开 `~`）；profile 严格解析且 model 字符串必须相等，fake provider 被拒绝。模型服务若只提供浮动别名，不能据此宣称固定了服务端版本。配置不会写回真实用户配置。

```bash
# 仅展示计划；不会读取真实模型配置或请求 API
node scripts/eval-local-code-mode.js --settings /tmp/code-eval-settings.json --dry-run
# 以下命令会产生真实模型费用：仅在用户确认之后执行
node scripts/eval-local-code-mode.js --settings /tmp/code-eval-settings.json \
  --allow-real-model --out /tmp/echo-code-eval-real-new
```

真实执行必须同时提供命令行 `--allow-real-model` 和一个未存在的输出目录；配置文件不能替代单次授权。可用 `taskIds` 选择上述任务 ID 进行小范围试跑；默认 9 任务 × 2 组 × repeats，每个 case 预算相同。第三组在 `groups` 增加 `"forced"` 后才执行，强制使用脚本是诊断提示而非新增权限，仍保留原生工具；原生调用痕迹可用于识别不遵从该提示的情况。不要把 forced 组当默认用户行为或把缺失的配对结果补成成功。

| 组 | 可见工具 | 评测提示 |
| --- | --- | --- |
| native | glob / grep / read_files | 原生调用 |
| optional | 三个原生工具 + run_code | 模型自行选择 |
| forced（可选） | 与 optional 相同 | 诊断性要求用脚本查询 |

所有组 **只读**：没有原生 Bash、编辑、网络、MCP、用户交互或子 Agent 工具，没有 unrestricted native 对照组。执行 `plan + readonly + headless deny`，且在 provider 结果进入 loop 前拦截白名单外请求，避免 loop 的 todo/问题特判绕过目录。请求被拦截即停止该 case，保留原始请求；绝不为测“会不会写”而执行危险工具。此处还额外检查读取路径限于临时 fixture，包括已存在符号链接目标；这是**评测约束**，不是产品工具普遍的 workspace 保证，也不是能消除 TOCTOU 的 OS 沙箱。

### 预算和原始证据

- `turns`：provider 调用尝试数；`tools`：每个原生/外层调用尝试计 1，**每个脚本内部尝试另计 1**，不是整个脚本无论多少查询都只算 1。非法、拒绝和失败尝试也计数；批量声明或执行器补记可能令“尝试数”超过 cap，但超预算不会继续放行更多宿主派发。单脚本仍受上述固定 16 次上限约束。
- `tokens`：provider 报告的 input（含缓存）+ output，缓存细项不二次相加；修复和重试的已报告用量不丢弃。**只在响应边界停止，不是服务端 max-output-token 硬上限**，单个响应可能超出，失败请求/SDK 内部重试的未报告费用无法估算。真实运行缺 usage 就停止，不编造 0。需要费用硬上限时同时使用服务端账单限制。
- `wallMs`：每 case 的 AbortSignal 预算，传给真实 provider/工具链。它不是整批费用上限，也不能保证不响应取消的第三方 SDK 在该时刻已结束；QuickJS 自身另有 watchdog。不要把这些预算解释成服务端最大收费承诺。
- 各组使用相同模型/effort/夹具/计费语义，交替配对先后顺序；不声明消除了缓存、负载或模型随机性。运行时不可用就拒绝评测，不能默默把 optional 变为 native。
- 输出每 case JSON 与 `report.json`，含模型标识、实际工具定义、Node/平台及运行时/评测目录 hash、fixture 前后 hash/权限/类型、原始 provider 输入/返回、外层结果、内部 envelope、审计/生命周期、失败/重试诊断。目录 hash 用于识别构建差异，不代替固定依赖和服务端模型版本。原始证据可能很大；不得把它当适合直接发布的脱敏日志。
- 分别记录脚本采用、首次脚本**执行**成功、首次脚本**独立任务验收**成功、任务最终成功、脚本重试/修复次数、原生 fallback、总已报告 usage/墙钟/工具尝试。native 没采用脚本时，首次脚本指标分母为 0，不伪装成 100%。修复成本全部保留。离线汇总明确标注不是模型性能。

### 被阻止的请求不等于实际逃逸

`deniedRequests` 记录观测到的 provider 白名单外请求、评测路径拒绝及 bridge 拒绝；它们没有被执行，不能称为“发生越权”。guest 在发出合法 bridge 消息之前访问不存在的方法，可能只表现为脚本错误，**不能从源码静态猜测精确拒绝次数**；源码和错误留在原始证据中。

fixture 前后快照比较文件内容 SHA-256、文件/目录类型、链接目标、权限及新增/删除，不追踪 atime。检测到任何持久改动立即标记 `releaseBlocked:true` 并停止后续 case，不因答案正确而放行。**快照只覆盖 fixture 树中的持久状态**：不能检测写后恢复、外部文件改动、内存/进程/网络副作用、仅元数据时间戳变化或任意运行时漏洞；也不是系统调用审计。模型 API 网络是显式授权的 provider 通道，不属于获准的工具网络访问。

因此 `fixtureChanges:[]` 仅表示未观察到该范围内改动，不是证明“零副作用/无法逃逸”。另有证据发现实际越权同样阻止发布。报告不能把 blocked attempts、脚本错误、fixture 改动或未观测的外部副作用混为一个 success 数字。真实模型可靠性、跨平台限制和收益须在经用户批准的专项评测后再给结论；证据不足时仍保持默认关闭与实验性质。
