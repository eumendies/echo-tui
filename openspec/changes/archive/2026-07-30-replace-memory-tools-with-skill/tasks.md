## 1. Built-in skill 基础设施

- [x] 1.1 扩展 skill source 类型和 registry，使其按 builtin → user → project 优先级发现并覆盖同名 skill，同时保留完整正文和资源清单
- [x] 1.2 调整 skill 状态映射，使当前生效的 builtin skill 使用用户级 `~/.echo/skills/skills.json`，且 `/skills` 不会写入 npm 安装目录
- [x] 1.3 增加 built-in skill discovery、同名覆盖、启停状态和资源清单的自动化测试

## 2. Agent memory skill 与脚本

- [x] 2.1 添加内置 `agent-memory/SKILL.md`，说明适用条件、scope 选择、稳定信息边界，并禁止直接编辑内部 memory 文件或操作 user memory/enabled 状态
- [x] 2.2 在 `SKILL.md` 中定义 read/add/update/remove/validate action、参数引用规则、成功 JSON、失败 exit code 和示例调用
- [x] 2.3 实现普通 CommonJS memory 脚本，解析严格 CLI 参数并复用编译后的 `agent-memory-store` 完成各 action
- [x] 2.4 为脚本补充读取过滤、默认 project scope、global scope、更新删除、最后 item 清理、无效参数、无效存储和 user memory 隔离测试
- [x] 2.5 验证脚本写入的数据可由 `/memory` 读取和修改，且 `/memory` 写入的数据可由脚本读取，无需迁移现有文件

## 3. 构建与 npm 发布

- [x] 3.1 扩展构建资源复制逻辑，把 built-in skill 的 `SKILL.md` 复制到稳定的 `dist/src` 路径，并确保 CommonJS 脚本位于同版本目录
- [x] 3.2 增加构建产物和 npm 发布文件清单测试，确认 `dist/src` 中包含完整 `agent-memory` skill 资源
- [x] 3.3 增加从模拟 npm 安装目录加载 skill 并执行脚本的测试，确认相对 require 不依赖 cwd 或固定 npm 前缀

## 4. 移除 provider memory tools

- [x] 4.1 从默认 tool registry 删除四个 memory handlers，并删除 `memory-tool-handler` 及其 tool execution/schema 测试
- [x] 4.2 从风险分类器删除 memory tool-name mutation 分支和 memory approval preview，不新增 memory 脚本专属审批分类
- [x] 4.3 删除 memory tool 专属 renderer 和顶层路由，更新旧 memory records 使用通用 renderer 的回归测试
- [x] 4.4 更新所有 provider/default registry 测试，断言 normal、plan 和 headless 工具定义均不包含 `read_memory`、`add_memory`、`update_memory`、`remove_memory`

## 5. Prompt、usage 与 headless 行为

- [x] 5.1 修改折叠 agent memory prompt，引导模型按需加载 `agent-memory` skill，并移除全部 `read_memory` 文案
- [x] 5.2 更新 memory prompt 测试，覆盖展开模式保持不变、折叠模式 skill 路由和存储错误回退
- [x] 5.3 更新 context usage 分类与测试，使 skill catalog 计入 Skills、`use_skill` 和脚本 bash 历史计入 Tools，并移除 `read_memory` 特例
- [x] 5.4 更新 `--once` 测试，确认未命中通用高风险规则的 memory 脚本无需 `--full-access` 即可执行，plan mode 仍按现有 bash allowlist 拒绝 Node 脚本

## 6. 文档与验证

- [x] 6.1 更新架构文档和相关 OpenSpec 主规格，说明 memory 从专属 tools 迁移到 built-in skill、`/memory` 保留及无专属审批的产品语义
- [x] 6.2 清理源码、测试和文档中不再成立的四个 memory tool 名称及 Remembering/Recalling/Revising/Forgetting 预期
- [x] 6.3 依次运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查，修复全部失败
- [x] 6.4 整理供用户执行的交互验证清单：skill 自动加载、脚本新增/读取/更新/删除、`/memory` 纠错、global/project scope、`/skills` 启停、普通 TUI 与 plan/headless 行为
