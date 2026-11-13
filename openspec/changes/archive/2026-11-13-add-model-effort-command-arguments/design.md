## Context

两个命令的 handler 目前只有无参数路径：

```ts
match(text: string): boolean {
  return text.trimEnd() === '/model';   // /effort 同款
}
```

`/mode` 已提供可直接复用的形状：`match` 用 `/^\/mode(?:\s+.*)?$/`，`start` 内解析参数，无参数开面板、非法参数开 usage surface、有效参数直接应用且不打开 session。

面板展示内容决定了参数应该匹配哪个字段：

- `/model` 的 select option 为 `{label: model.model, description: model.provider}`，展示的是模型名而非 profile id。
- `/effort` 的 scale option 为 `{label: effort, description: EFFORT_DISPLAY_LABELS[effort]}`，展示的是 `none`/`low`/… 小写值与 `NONE`/`LOW`/… 大写标签。

## Goals / Non-Goals

**Goals:**

- 让用户用面板里看到的名字直接切换模型或 effort。
- 参数失败时给出可发现的候选，而不是静默失败或退回消息路径。
- 与 `/mode` 的参数形状保持一致，减少三套命令的语义分叉。

**Non-Goals:**

- 不引入 profile id 参数、`provider/model` 复合参数或模糊/前缀匹配。
- 不改变无参数面板行为、鼠标/滚轮语义或 `CommandHost` 端口签名。
- 不在成功时插入 notice，也不写 transcript。

## Decisions

### 1. 参数匹配面板 label，而不是 profile id

`/model` 面板展示 `model.model`，用户看不到 profile id。接受 id 会让「看到什么就能输入什么」失效，也会让 `/model default` 这类输入成为只有读配置的人才知道的隐藏入口。

因此 `/model <参数>` 与 `models[].model` 精确比较，命中后反查该 profile 的 `id` 传给 `host.model.selectModel(id)`。

替代方案是同时接受 id 和 model 名。不采用：两个命名空间可能冲突（某个 profile 的 id 恰好等于另一个 profile 的 model 名），需要额外的优先级规则和错误提示，收益不足。

### 2. 大小写不敏感比较

模型名不是配置键，用户手输时大小写不应造成失败；`/effort` 的 scale surface 同时展示小写 `label` 和大写 `description`，两种输入都应生效。实现上对两侧统一做 `toLowerCase()` 后比较。

### 3. 歧义与未命中都落到候选列表

两个 profile 可以引用同一个模型名（不同 provider）。此时无法从参数唯一确定目标，直接取第一个会静默改变用户不期望的 profile。

因此命中数不为 1 时统一打开 info surface：

- 未命中：标题说明无法匹配，列出全部候选并标出当前项。
- 多命中：标题说明匹配到多个 profile，同样列出候选，`description` 已包含 provider 便于区分。

候选列表使用与 select surface 一致的信息（模型名与 provider），当前项前缀 `*`。

### 4. 合法值集合直接来自 `REASONING_EFFORTS`

`/effort` 的有效值就是 `REASONING_EFFORTS` 全集，与 `createEffortCommandInfo()` 返回的 `efforts` 相同。参数校验不依赖 host，只在应用前调用一次 `selectEffort`。

非法值时展示六个合法值与当前模型/effort，用户可以直接照抄。

### 5. 先检查配置可读性，再应用

两个命令在无参数路径上区分「配置不可读」与「保存失败」两种文案。参数路径保持同样区分：

1. 调 `createModelCommandInfo()` / `createEffortCommandInfo()`，`'error' in info` 时打开现有配置错误 surface。
2. 参数匹配成功后调 `selectModel` / `selectEffort`，`!ok` 时打开现有保存失败 surface。

这样可以避免把配置错误误报成「无法保存」。

### 6. 成功时不打开 session、不插入 notice

与 `/mode normal` 一致：应用后直接返回，footer 状态行已反映新值。`/model` 会清除旧 effort override，该副作用在状态行同样可见。

不插入本地 notice 的理由：notice 会进入 transcript 并持久化，而模型/effort 切换不属于对话事实；现有面板路径也不产生记录。

### 7. 参数解析与匹配函数导出供测试

`parseModelArgument` / `resolveModelQuery` / `parseEffortArgument` 与 `parseModeArgument` 一样导出，测试直接覆盖解析与歧义分支，不需要为测试构造额外 host 分支。

## Risks / Trade-offs

- [Risk] 模型名在多个 profile 间重复时，参数永远无法直接命中。 → 这是有意行为：歧义必须由用户确认，候选列表的 `description` 已含 provider。
- [Risk] 大小写不敏感比较对某些 provider 的大小写敏感模型名可能误判。 → 模型名在配置中是精确字符串，两个 profile 仅大小写不同属于极端配置；此时会落入多命中分支而不是错误应用。
- [Risk] 参数路径绕过面板会让用户错过其它候选。 → 非法值或歧义都会展示完整候选列表，可发现性有保障。
- [Risk] `/model <名字>` 会清除 effort override，用户可能不知情。 → 与现有面板选择路径完全一致，且状态行立即反映；不额外插入 notice 是刻意的记录语义取舍。
