## Context

当前 skill manager 只把 discovered skill 与各 source root 下 `skills.json` 的 disabled 名单合并；`/skills` surface 的草稿也只有 selected index 和 enabled 状态。直接 `/<skill-name>` 调用会把 skill 正文包装为 user message，再进入普通 assistant turn；agent runtime 在单次调用开始时读取全局 `llm.selectedModel` 并初始化 provider，之后的 tool continuation 复用同一运行态。

本变更跨越 skill state、command surface、slash 提交流程和 provider 初始化。关键约束是：未指定时必须动态跟随当前模型；固定模型只影响显式 slash skill invocation 的当前 turn；模型自主 `use_skill` 不得触发运行中模型替换；任何路径都不能为了临时覆盖而改写用户的全局模型配置。

## Goals / Non-Goals

**Goals:**

- 在现有 `/skills` 单层 surface 中用 Left/Right 管理逐 skill 模型策略，并与启停状态一起按草稿保存或取消。
- 将固定策略保存为 model profile ID；没有 override 时在每次显式调用开始时解析全局当前模型。
- 通过 typed per-run option 把显式 slash invocation 的模型覆盖传到 agent runtime，使 provider、context window、tool registry 和 usage 都来自同一份覆盖后配置。
- 对旧 skill state 和已删除 model profile 安全降级，不因模型策略阻断 skill 使用。
- 保持自主 `use_skill`、普通 user turn、headless once 和全局 `/model` 行为不变。

**Non-Goals:**

- 不在 `use_skill` tool call 发生后重建 provider 或把一个 assistant turn 拆成多个模型阶段。
- 不为 `/skills` 增加下拉列表、二级菜单、搜索或独立模型配置编辑能力。
- 不修改全局 `llm.selectedModel`，也不让一次 skill override 延续到后续普通 turn。
- 不支持 skill 自己在 `SKILL.md` frontmatter 中声明模型，也不按 arguments 动态路由模型。

## Decisions

### skill state 使用可选 modelOverrides 映射

`skills.json` 升级为 schema version 2，并在现有 `disabled` 外增加可选对象：

```json
{
  "schemaVersion": 2,
  "disabled": ["unit-test"],
  "modelOverrides": {
    "code-review": "fast-model"
  }
}
```

键是当前 source root 下的 skill name，值是用户 LLM 配置中的 model profile ID。缺少键表示动态“当前模型”，不写入 `"current"` 等哨兵值。state store 按字段独立归一化：旧 version 1 文件继续提供 disabled 状态；缺失或无效的 `modelOverrides` 退化为空映射，但不应清除仍然有效的 disabled 数据。

继续沿用“状态跟当前生效 skill source root 绑定”的规则。项目级 skill 覆盖同名用户级 skill 时，模型 override 与 enabled 状态都从项目级 root 读取和写入。

选择 state 映射而不是修改 `SKILL.md` frontmatter，是因为模型选择属于用户运行偏好，不是 skill 作者声明的可移植能力。选择 profile ID 而不是底层 model 字符串，是因为 profile 同时决定 provider、凭据引用、reasoning、context window 等完整运行配置。

### `/skills` 使用一个动态选项和全部固定 profiles

打开 `/skills` 时同时读取 discovered skills、持久化 override 和最新 model profile 列表。每个 skill 的候选顺序为：

```text
当前模型（动态） → profile 1 → profile 2 → ... → 当前模型
```

候选列表包含当前全局选中的 profile，因为“动态跟随当前模型”和“固定为这个 profile”语义不同。UI 行内展示当前策略；选中行用 Left/Right 循环，Space 仍切换 enabled。两类修改只更新 command session data，Enter 才统一写入各 root 的 state，Esc 全部放弃。disabled skill 仍允许预设模型，以便后续启用后直接生效。

renderer 只消费已经解析好的短 model label，不读取 LLM 配置。窄终端优先保留 enabled pill、skill name 和模型策略，来源与描述使用剩余宽度截断。模型配置不可读时，surface 仍可管理 enabled 状态，并只提供“当前模型”选项。

### 显式 slash invocation 通过 typed per-run override 传递

模型覆盖采用独立字段沿调用链传递：

```text
SkillInvocationCommandHandler
  → CommandStartResult.modelProfileId?
  → AssistantTurnRunnerInput.modelProfileId?
  → AgentSessionInput.modelProfileId?
  → agent runtime initializeRunState
```

它不依赖解析 user record metadata，也不扫描历史 transcript，因此只可能影响当前显式 invocation。skillInvocation metadata 继续负责 skill 使用记录，不作为执行策略来源。

agent runtime 初始化时仍只读取一次配置，但允许以 model profile ID 覆盖 profile 解析结果。provider adapter、registry、context window、usage model 和后续 tool continuation 都从这份配置构造。运行结束后没有可恢复的全局模型状态，因为全局配置从未被修改。

相比临时调用 `/model` 再恢复，这种方案没有配置写入窗口、并发回调污染或异常恢复问题；相比在 command handler 中直接创建 provider，它保持 provider-neutral agent loop 为唯一编排入口。

### 无效 override 回退到运行时当前模型

model profile 可能在保存 skill state 后被删除或改名。显式 invocation 在运行开始时重新读取 LLM 配置；若 override ID 不存在，则按普通规则选择当前 profile，而不是让 skill turn 失败。下一次打开 `/skills` 时，无效 ID 也投影为“当前模型”，用户保存后会从 state 中移除该陈旧映射。

不自动改写 state，避免读取或执行 skill 时产生隐藏持久化副作用。

### 自主 use_skill 不读取 model override

`use_skill` handler 继续只加载 instruction 和 resources。agent 已在 tool call 前完成初始化，handler 不访问 model override，也不请求 agent loop 重建 provider。因此：普通 turn 中自主 `use_skill` 保持当前模型；显式 slash turn 中后续自主加载另一个 skill 时，保持该 slash turn 已选择的模型，不切换到另一个 skill 的 override。

## Risks / Trade-offs

- [Risk] profile ID 改名后持久化映射失效。→ 每次 invocation 重新验证，失效时回退当前模型；`/skills` 将其归一化为动态策略。
- [Risk] “当前模型”和固定为当前 profile 的显示值接近，用户可能混淆。→ label 明确区分“当前/动态”和具体 profile，hint 说明 Left/Right 切换模型策略。
- [Risk] 模型列表或较长 label 挤压 skill 描述。→ renderer 优先保留交互必需字段，描述按剩余宽度截断，不增加第二层 surface。
- [Risk] status line 若仍表达全局当前模型，会与单 turn override 不一致。→ active assistant turn 持有独立 transient model state，固定 override 执行期间显示 `<model> (SKILL override)`，收尾后恢复全局模型；不修改或复用全局 model 选择状态。
- [Risk] 项目级 `skills.json` 中的 profile ID 在其他用户机器上不存在。→ profile ID 不含凭据；其他环境按无效 override 回退当前模型。

## Migration Plan

1. reader 接受现有 version 1 文件，并把缺失的 `modelOverrides` 视为空映射。
2. 用户首次通过 `/skills` 保存后写出 version 2 完整状态。
3. 无需批量迁移；所有已有 skill 默认继续使用当前模型。
4. 回滚到旧版本时，旧 reader 仍只读取 `disabled`，额外字段不会影响启停状态。

## Open Questions

无。
