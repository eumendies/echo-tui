## 1. 扩展 Subagent 配置领域模型

- [x] 1.1 在 `SubagentDefinition` 和冻结逻辑中加入三态 `skillNames`，保持内置 Explorer/Worker 缺省允许全部 enabled Skills，并补充定义单元测试。
- [x] 1.2 扩展自定义 manifest parser/serializer，支持可选 `skills` 序列、显式空序列、名称预算与重复/非法值校验，并覆盖旧 manifest 往返兼容测试。
- [x] 1.3 将内置 `agents.settings.json` schema 升级为 version 2，兼容读取 version 1，并实现 model、effort、skills 完整条目的来源遮蔽、序列化和原子写测试。
- [x] 1.4 更新 Subagent catalog 与管理存储，把 Skill 策略转换为冻结定义；保留 missing/disabled 名称而不使定义失效，并验证高优先级来源与无效配置诊断。

## 2. 建立同源 Skill 快照与作用域

- [x] 2.1 增加不可变运行级 Skill registry snapshot 和 scoped registry，按 undefined、空数组、名称交集实现 `listCatalog`/`loadSkill` 一致过滤，并限制失败结果中的 available Skills。
- [x] 2.2 让 Agent/tool 装配支持注入 Skill registry，确保 Primary catalog 与 `use_skill` 共用同一 snapshot，同时保持 MCP registry 合并和现有默认装配行为。
- [x] 2.3 当运行 registry 不包含 `use_skill` 时返回空 Skill catalog，覆盖“prompt 不宣传不可调用 Skill”和伪造未授权加载失败测试。
- [x] 2.4 覆盖 disabled、missing、project/user/builtin 同名覆盖和运行中 Skill 文件或状态变化不影响既有 snapshot 的 Skill 层测试。

## 3. 接入父子 Agent Runtime

- [x] 3.1 在 primary loop 初始化时捕获完整 enabled Skill snapshot，并调整父子运行协议传递未裁剪的同源 Skill 视图而不是父模型投影结果。
- [x] 3.2 在 Subagent 最终模型解析后应用定义 allowlist并按子模型 context window 独立创建 catalog 投影，在全部 continuation 和 observation 中复用该结果。
- [x] 3.3 验证 Explorer、Worker、readonly/general 自定义 Agent 的 catalog 与 `use_skill` 加载范围一致，且 Skill 策略不改变工具、MCP、审批、plan/headless 和递归委派边界。
- [x] 3.4 增加并行 readonly 与连续 general 委派测试，确认各运行共享不可变父 snapshot但隔离 scoped registry、已加载正文和 provider continuation。

## 4. 扩展 `/agents` 管理界面

- [x] 4.1 扩展 command 类型和 agents command port snapshot，提供当前 effective Skill 的名称、来源、enabled 状态以及已配置 stale 名称所需信息。
- [x] 4.2 为自定义 Agent 表单加入 Skills 字段和独立多选层，支持“全部 enabled”、显式空集合、逐项 allowlist及 missing/disabled 项保留，并更新草稿转换和保存校验。
- [x] 4.3 为内置 Explorer/Worker 策略表单加入同样的 Skills 编辑能力，同时保持 description、prompt、capability、tools和MCP只读以及完整 override 冲突语义。
- [x] 4.4 更新 agents footer 列表、详情、字段和多选渲染，显示 all/no/count、来源与不可用状态，并补充 command handler、port 和 renderer 测试。

## 5. 文档与验证

- [x] 5.1 更新架构与用户文档，说明 manifest/settings 示例、三态 allowlist、来源覆盖、运行快照以及该功能不是文件路径保密边界。
- [x] 5.2 运行 `npm run typecheck` 并修复所有类型错误。
- [x] 5.3 运行 `npm test` 并确保完整自动化测试通过。
- [x] 5.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 完成 JavaScript 语法检查。
- [x] 5.5 手工验证 `/agents` 自定义/内置 Skill 配置、下一 turn 生效、Explorer/Worker 实际加载限制、并行子运行、headless 与终端清理行为。
