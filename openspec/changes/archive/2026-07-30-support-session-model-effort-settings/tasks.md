## 1. Session settings 数据与存储

- [x] 1.1 定义 session model settings、读取结果和 store contract 类型，为每个结构化字段补充符合仓库规范的中文领域注释
- [x] 1.2 实现 `{session-id}.settings.json` 路径解析、严格归一化读取和临时文件加 rename 的原子当前值覆盖，不在文件中保存 profile 定义或历史值
- [x] 1.3 为 settings store 补充缺失、损坏、schema/sessionId 不匹配、显式 `none` effort、原子覆盖和孤立 sidecar 的单元测试

## 2. Session 创建与生命周期

- [x] 2.1 保持有效 journal 仅在首个 record 创建，并让 journal 自行生成 session id、`/status` 创建状态和既有 JSONL schema 不变
- [x] 2.2 在首次 user record 提交后按真实 session id 尽力同步 settings；settings 失败不阻断 transcript 或 provider
- [x] 2.3 在 `/resume` 中恢复有效 sidecar，并为缺失、损坏或旧 session settings 应用全局默认兼容回退和后续静默重试
- [x] 2.4 在 `/clear` 中解绑旧 session settings并从最新全局默认初始化新 session，同时保证旧 sidecar 可再次恢复
- [x] 2.5 补充首次创建、失败边界、resume、clear、旧 session 和孤立 sidecar 不进入候选列表的 controller/store 测试

## 3. ModelContext 与命令语义

- [x] 3.1 重构 `ModelContext`，分别缓存全局 model catalog/default 与当前 session 的 modelProfileId、effort override 和有效展示状态，保持 footer redraw 只读内存
- [x] 3.2 将 `/model` 改为保存当前 session profile并清除旧 effort override，将 `/effort` 改为保存当前 session override，移除两者对用户级 LLM 配置的写入
- [x] 3.3 将 composer model tuning 的确认事务改为一次更新当前 session model 与显式 effort，并静默尽力保存 sidecar
- [x] 3.4 调整 `/config` 与配置 watcher 刷新：有效 session profile 保持不变，profile 定义刷新，当前 profile 被删除时回退全局默认、持久化有效值并清理旧 usage
- [x] 3.5 更新 ModelContext、slash command、command host 和 composer tuning 测试，验证两个 session 隔离、全局配置不被改写、model 切换清除 effort、`none` 保留及写入失败仍更新内存缓存

## 4. Agent 运行时合并

- [x] 4.1 让 `AppContext.getAgentSession()` 为普通交互 turn 提供当前 session modelProfileId 和可选 reasoningEffortOverride
- [x] 4.2 在 assistant turn 边界按字段合并显式 skill override 与 session settings，避免 `undefined` 覆盖 session 值，并保持 `none` 与 tool continuation 的固定配置语义
- [x] 4.3 调整 status line、active skill override 和 context usage 清理逻辑，使默认展示恢复 session 值且 model/effort 成功变化后不显示旧 usage
- [x] 4.4 补充普通 turn、仅 model skill override、仅 effort skill override、无 override skill、active status line 和 context usage 的 runner/runtime 测试

## 5. 兼容性、文档与验证

- [x] 5.1 验证 `--once` 不创建或读取 session settings并继续使用全局默认/per-run override，补充 headless 回归测试
- [x] 5.2 更新 README、TUI 架构文档和相关配置说明，明确全局默认、session 当前值、sidecar 路径、resume/clear 与 skill override 优先级
- [x] 5.3 运行 `npm run typecheck` 并修复全部类型错误
- [x] 5.4 运行 `npm test` 并修复全部自动化测试失败
- [x] 5.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 完成 JavaScript 语法检查
