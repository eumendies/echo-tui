## Context

当前 skill state 使用 source root 下的 `skills.json` 保存 `disabled` 和 `modelOverrides`，`/skills` 以单层列表展示这些草稿，并直接用 Left/Right 循环 model profile。direct slash invocation 会把可选 `modelProfileId` 贯穿到 assistant turn 和 agent setup，使该 turn 使用指定 profile 的完整配置；模型自主调用 `use_skill` 不会切换模型。

Reasoning effort 目前属于 model profile 配置，普通 `/effort` 命令会修改全局当前 profile。缺少 skill 级 effort 时，用户若想让某个 skill 使用不同推理深度，只能新增重复 model profile 或在调用前后修改全局配置。该变更跨越 skill state、command surface、turn 初始化和状态展示，但不得改变普通 turn、全局模型选择或 tool continuation 的模型稳定性。

## Goals / Non-Goals

**Goals:**

- 为每个 discovered skill 保存可选的 reasoning effort override，并明确区分“模型默认”和显式 `none`。
- 让 `/skills` 在不增加二级菜单的情况下管理模型与 effort 两个字段，并保持当前模型切换按键习惯。
- 仅在 direct slash invocation 初始化时应用 effort override，并在整个 turn（含 tool continuation）保持一致。
- 兼容既有 skill state，且让 model 与 effort 的无效配置分别降级。
- 在窄终端中优先保留可操作状态、skill 名称及当前活动策略字段。

**Non-Goals:**

- 不让模型自主发起的 `use_skill` 在进行中的 turn 内切换 effort 或重建 provider。
- 不修改 `/effort` 的全局 profile 编辑语义，也不写入 `llm.selectedModel`。
- 不为不同 provider 或 model 建立 effort capability 矩阵；候选值沿用现有 `ReasoningEffort` 集合。
- 不增加新的 `/skills` 子命令、下拉框或二级详情页。

## Decisions

### 1. 使用独立 `effortOverrides` 映射扩展 skill state

状态文件升级为 additive schema：

```json
{
  "schemaVersion": 3,
  "disabled": [],
  "modelOverrides": {
    "code-review": "deep-profile"
  },
  "effortOverrides": {
    "code-review": "high"
  }
}
```

缺少 `effortOverrides[skillName]` 表示“模型默认”，值存在时必须属于 `none | minimal | low | medium | high | xhigh`。显式 `none` 是有效 override，不得因其表示关闭 reasoning 而与字段缺失合并。

选择独立映射而不是把现有状态重构为嵌套 `overrides`，可以保持旧字段含义、减少迁移范围，并让 model 与 effort 的读取失败独立降级。读取不依赖文件声明的旧 schema version：旧文件自然得到空 effort map；写入时统一输出新版本和排序后的映射。

### 2. `/skills` 使用字段焦点，而不是新增一组修饰方向键

command session 增加 `activeField: 'model' | 'effort'`，打开时默认为 `model`。输入规则为：

- Up/Down 选择 skill；
- Tab/Shift+Tab 在 model 和 effort 间切换活动字段；
- Left/Right 循环当前活动字段的候选值；
- Space、Enter、Esc 继续分别表示启停、保存和取消。

model 候选保持“当前模型 + 有效 profiles”；effort 候选为“模型默认 + 全部 `ReasoningEffort` 值”。这延续项目中 Tab 切换 command surface 焦点的既有语义，也无需扩展 key parser 来兼容 Shift+Arrow。直接让 Tab 改变 effort 值虽然按键更少，但会违背现有 Tab 的焦点语义；使用 `[`/`]` 则可发现性和键盘布局适配较差。

surface 同时展示两个策略值，并对当前选中行使用既有 `▌` 和 selection background，对活动字段使用更强的 accent。宽度不足时先移除 description，再裁剪非活动字段和长 model label；enabled 状态、skill 名称及活动字段必须优先保留。

### 3. Effort override 独立于 model override

切换 model 草稿不会重置 effort 草稿，反之亦然。最终执行配置按以下顺序解析：

```text
全局当前 profile 或有效 skill model override
                       │
                       ▼
            profile 的 reasoning effort
                       │
       存在 skill effort override 时覆盖
                       ▼
             当前 turn 的实际配置
```

因此：

- “模型默认”始终继承调用开始时最终选中 profile 的 effort；
- 显式 effort 覆盖固定或动态 model profile 自带的 effort；
- 固定 model profile 已删除时，model 回退全局当前 profile，但有效 effort override 仍可独立应用。

该规则避免修改一个字段时产生隐式副作用，也让 model 与 effort 的陈旧配置可以分别处理。

### 4. 通过显式 per-turn 字段传递 override

direct slash invocation 结果、assistant turn 参数和 `AgentSessionInput` 增加可选的 effort override 字段，并传入 agent setup / LLM config 解析。字段命名应明确包含 `Override`，避免与 profile 解析后的实际 `reasoningEffort` 混淆。

agent setup 先解析 model profile，再覆盖其 reasoning effort，并只在 turn 初始化时创建 provider agent。这样 tool continuation 复用同一 agent/config，自然保持 effort 稳定；普通 user turn和自主 `use_skill` 路径不传该字段，因此行为不变。

### 5. 状态展示使用最终有效配置并合并 skill override 提示

只要当前 direct slash turn 应用了有效 model 或 effort override，status line 就将模型标记为 `SKILL override`，同时 effort segment 展示最终有效值。user record 后追加一条本地 notice，概括本轮采用的 model/effort override；两者同时存在时不生成两条重复 notice。

turn 完成、失败或中断后恢复全局 model/effort 状态。无效 model profile 回退时，如果仍有有效 effort override，则保留 override 标记和 effort 提示；只有所有 override 均未生效时才不显示标记或 notice。

## Risks / Trade-offs

- [行内增加字段会压缩 skill 名称和描述] → 明确窄终端内容优先级，复用 safe render width，并针对中窄宽度增加 renderer 测试。
- [“模型默认”和 `none` 容易在数据层被混淆] → 使用字段缺失表达继承，使用 `ReasoningEffort` 联合类型保留显式 `none`，为读写和运行时合并添加独立测试。
- [状态 schema 升级可能损坏既有 enabled/model 状态] → 采用 additive reader，逐字段 normalization；旧文件读取测试与原子写入策略保持不变。
- [per-turn 参数继续扩散使函数签名复杂] → 仅在现有 model override 链路上增加同级显式字段，不引入通用任意配置对象，维持可审计边界。
- [某些 provider 不支持所有 effort 值] → 与现有 `/effort` 保持同一候选集合和 adapter 语义，本 change 不声称提供 capability 检测。

## Migration Plan

1. reader 先支持缺失或有效 `effortOverrides`，现有 schema v1/v2 文件无需预处理即可读取。
2. `/skills` 下一次保存时将对应 root 原子写为新 schema，并保留有效 enabled/model 状态。
3. 如需回滚，旧版本会忽略未知 `effortOverrides` 字段；enabled 和 model 数据仍保持原字段格式。旧版本再次保存可能丢弃 effort 配置，但不会破坏其他状态。

## Open Questions

无。首版沿用现有统一 effort 候选集合；未来若引入 provider capability 检测，应作为独立 change 处理。
