## Context

当前 agent memory 同时包含两层能力：`agent-memory-store` 负责版本化 catalog/item 存储、scope 解析和原子写入；四个 provider-visible memory tools 负责把该 store 暴露给模型。后者约占 493 个估算 tokens，并在与 memory 无关的请求中持续出现。与此同时，`/memory` 已经提供完整的用户可见管理面板，memory prompt 也会在每轮请求中自动注入预算内的有效内容。

本变更跨越 skill discovery、npm 构建产物、agent memory 接口、默认 tool registry、tool rendering、风险分类和 headless 行为。实现必须继续支持 Node.js >= 20、CommonJS 编译产物和 npm 全局/局部安装，不引入 Python、ts-node、tsx 或其他运行时依赖。

## Goals / Non-Goals

**Goals:**

- 从所有 provider 请求中移除四个常驻 memory tool definitions。
- 用按需加载的内置 `agent-memory` skill 和固定脚本提供等价的 agent catalog/item 读写能力。
- 让脚本与 `/memory` 复用同一份 store 和数据格式，不迁移或复制存储协议。
- 保留 user memory、agent memory prompt 注入、scope、enabled 状态和 `/memory` 人工纠错入口。
- 保证内置 skill 资源随 npm 包发布，并可从实际安装目录稳定执行。

**Non-Goals:**

- 不改变 `~/.echo/memories.json` 或 `~/.echo/agent-memory/` 的数据格式。
- 不允许 agent memory skill 操作 user memory 或 catalog/item 的 enabled 状态。
- 不为 memory 脚本新增专属审批、风险分类或终端 renderer。
- 不改变 plan mode 的 bash allowlist；因此 plan mode 不执行 Node memory 脚本。
- 不为旧 memory tool transcript records 保留专属展示兼容层。

## Decisions

### 1. 以包内 built-in skill 取代用户目录 bootstrap

新增最低优先级的 `builtin` skill 来源，发现顺序为 built-in、user、project，后发现的同名 skill 继续覆盖先发现项。`agent-memory` 的 `SKILL.md`、`reference/` 和 `scripts/` 作为版本化资源随应用安装，而不是由 postinstall 复制到 `~/.echo/skills`。当 built-in skill 是当前生效来源时，其 enabled 状态写入用户级 `~/.echo/skills/skills.json`，不得写入 npm 安装目录；因此它仍可通过 `/skills` 管理。

这样 npm 更新会同步更新脚本和协议说明，也避免全局安装、pnpm 链接或不同安装前缀下依赖硬编码路径。built-in skill 的 source path 来自运行中包的 `__dirname`，`use_skill` 返回该绝对 source path 和相对资源清单。

替代方案是 bootstrap 到用户目录，但“只创建不覆盖”的幂等规则会让旧脚本长期滞留；安装时强制覆盖又会破坏用户文件，因此不采用。

### 2. 使用普通 CommonJS JavaScript 脚本

脚本使用 `.js`，通过当前 Node.js 运行时执行。它只负责解析命令行、调用 store 和向 stdout 输出稳定 JSON；不独立实现 JSON 读写协议。脚本从包内相对路径 require 编译后的 `dist/src/memory/agent-memory-store.js`，因此与 store 同版本发布。

不使用 TypeScript 脚本，因为生产环境没有 ts-node/tsx；不使用 Python，因为 npm 包只保证 Node.js >= 20，不能假设用户系统存在兼容的 Python 命令。

构建阶段显式复制包含完整操作协议的 `SKILL.md`；`allowJs` 编译流程负责把脚本放入对应 `dist/src` 路径。npm 的 `files` 已包含 `dist/src`，发布测试需要验证 tarball 文件清单和安装后执行路径。

### 3. 脚本只暴露旧 agent tools 的领域能力

脚本提供 `read`、`add`、`update-item`、`update-catalog`、`remove-item`、`remove-catalog` 和 `validate` action：

- `read` 使用 effective catalog 解析，返回实际 scope、enabled items 和精确 mutation 所需 item id。
- `add` 默认 project scope，新 catalog 必须提供 description。
- update/remove 必须显式指定 read 返回的 scope；所有 mutation 拒绝 disabled catalog，并保留最后一项删除 catalog 的规则。
- `validate` 只校验当前 cwd 可访问的 global/project 存储，不修复或覆盖无效文件。
- 所有成功输出使用 JSON，失败写入简洁 stderr 并返回非零 exit code。

Skill 明确禁止模型直接读取或 patch 内部 agent memory JSON，并要求始终调用随当前 skill source 发布的脚本。脚本不导出 user memory mutation，也不导出 enabled mutation；这些操作继续只由 `/memory` 提供。

### 4. 通过现有 bash 工具执行，不新增 memory 审批

模型先调用 `use_skill`，再使用 `run_bash_command` 执行绝对路径下的脚本。参数采用固定 action 和显式 flags；skill reference 规定 shell quoting，脚本执行严格参数校验。

不在审批风险分类器中识别 memory script。因而简单的 `node <script> <action> ...` 在 normal mode 按普通低风险 bash 执行，在默认 `--once` 中同样可执行；用户通过 `/memory` 事后查看、停用、编辑或删除。若模型生成的命令本身命中通用高风险 bash 规则，仍按通用规则处理。plan mode 下 `node` 不在只读 allowlist，read 和 mutation 都会被现有策略拒绝。Workspace change history 单独精确识别当前安装包内且不含 shell 组合或命令替换的固定脚本调用，避免其对 `~/.echo` 的操作错误清空 `/undo` 文件历史；该识别不改变审批或 plan mode 语义。

这是有意接受“事后可见和可撤销，而非写入前授权”的产品语义。替代方案是 canonical script 专属审批，但会重新引入 memory 特例，本阶段不采用。

### 5. 彻底删除旧 tool 接口，保留共享 store

删除 memory tool handler、默认 registry 注册、tool-name 风险分支、memory approval preview 和 memory 专属 renderer。旧 transcript 中的相关 records 由通用 tool renderer 处理。Provider、usage 和测试不再期待四个工具名。

保留 `agent-memory-store`、`memory-store`、memory types、memory prompt、command port、`/memory` handler/surface 和它们的测试，因为这些模块同时服务持久化注入与人工管理。脚本复用 store 不代表保留 memory tool 层。

### 6. Memory prompt 通过 skill 路由折叠检索

展开模式继续直接注入全部有效 items。折叠模式不再指示调用 `read_memory`，而是提示在需要读取 catalog 或维护稳定记忆时加载 `agent-memory` skill。Skill catalog 本身继续按现有预算计入 System prompt 下的 Skills；脚本的 `use_skill`、bash call/result 按普通工具历史计入 Tools。

## Risks / Trade-offs

- [脚本通过 shell flags 传递多行或含引号内容时可能生成错误命令] → SKILL/reference 给出唯一推荐调用格式和引用规则，脚本拒绝未知、重复或缺失参数，并用非零退出码返回诊断。
- [复用编译后内部模块会与目录布局耦合] → 脚本和 store 保持在固定的 `dist/src` 相对结构中，并增加构建产物与 npm pack/install 测试。
- [默认 `--once` 可以无审批写入 memory] → 将其作为明确的临时产品语义记录，限制脚本只写 agent memory，并保留 `/memory` 的完整事后管理能力。
- [Plan mode 连只读 memory 脚本也不能执行] → 接受现有 bash allowlist 行为，不增加 memory 例外；需要读取时退出 plan mode或使用已注入内容。
- [用户或项目同名 skill 覆盖内置 skill后可能失去固定脚本约束] → 内置资源不被删除，默认安装始终可用；文档明确覆盖属于高级自定义行为，且仅在 built-in 为生效来源时把状态保存到用户级 skill state。
- [删除专属 renderer 后旧 session 展示退化] → 依赖通用 renderer 保证安全显示，不保留已移除工具的运行时代码。

## Migration Plan

1. 先增加 built-in skill 发现、资源复制和安装产物测试，不改变现有 memory tools。
2. 增加并独立测试 `agent-memory` 脚本，确认与 `/memory` 对同一存储的读写互通。
3. 修改 memory prompt 路由文案并删除四个 tool definitions、handler、审批和 renderer。
4. 更新 provider、context usage、headless、文档和测试中的旧工具预期。
5. 使用已有 memory 文件验证无需迁移即可被 prompt、skill 脚本和 `/memory` 同时读取。

回滚时可恢复旧 tool handler/registry；store 格式未变，因此不需要数据回滚。新版本创建的 catalog/item 仍可被旧版本读取。

