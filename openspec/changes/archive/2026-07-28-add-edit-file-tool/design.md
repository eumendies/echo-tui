## Context

echo-tui 当前由 `prepareAgent()` 在每次 assistant run 开始时读取 `~/.echo/config.json`、构造默认 tool registry，再由各 provider adapter 把 registry definitions 转换成 provider tool schema。文件写入能力目前只有 `apply_patch`：handler 负责解析 V4A/Begin Patch 与 unified diff、在内存中模拟、写盘、调用 `ChangeFileRecorder`，并把 display-only metadata 持久化到 tool result；TUI 通过 apply-patch 专属 renderer 展示按文件和行组织的红绿差异。

本变更横跨配置、registry、工具执行、审批、transcript 类型、渲染和 change history。实现必须保持 provider-neutral，不引入第三方 TUI 或 diff 依赖，不改变 append-only transcript 和 headless deny-by-default 语义，并兼容已有 session 中的 `apply_patch` metadata。

## Goals / Non-Goals

**Goals:**

- 提供参数稳定、模型易生成的 `edit_file(path, old_string, new_string, replace_all?)` 精确替换工具。
- 允许用户通过 `/config` 与 `tools.fileEdit.mode` 在 `apply_patch` 和 `edit_file` 之间确定性选择。
- 每个 assistant run 只向模型暴露一个文件编辑工具，且执行 registry 与 provider schema 保持一致。
- 复用现有审批、plan/headless policy、change recorder、`/undo`、`/diff` fallback 和 tool transcript 生命周期。
- 将现有 apply-patch 差异投影泛化，使 `edit_file` 获得相同的路径标题、增删统计、行号 gutter、上下文折叠、红绿背景、宽度安全和展示预算。
- 保持旧 `apply_patch` transcript/session 无迁移可恢复。

**Non-Goals:**

- `edit_file` 第一版不创建、删除、移动或重命名文件；这些能力继续由 `apply_patch` 模式或其他经授权工具提供。
- 第一版不支持正则表达式、模糊匹配、忽略空白、大小写不敏感或自动缩进修复。
- 第一版不支持一次调用编辑多个文件或提交 `edits[]` 批次。
- 不改变 `apply_patch` 的 patch 解析与执行语义，也不在 system prompt 中规定工具优先级。
- 不为配置切换迁移历史 tool call；历史记录继续以创建时的工具名和 metadata 保存。

## Decisions

### 1. 使用 `tools.fileEdit.mode`，默认 `apply_patch`

配置采用：

```json
{
  "tools": {
    "fileEdit": {
      "mode": "apply_patch"
    }
  }
}
```

有效值只有 `apply_patch` 与 `edit_file`。缺失、类型错误或未知值按字段独立回退 `apply_patch`，保证升级后行为不变。共享的配置归一化函数和 `FileEditToolMode` 类型应由 `app-settings-config` 与 `llm-config` 共用，避免 UI 草稿和 runtime 对同一字段产生不同解释。

保存仍由常规设置编辑器执行原子 JSON 更新，只更新 `tools.fileEdit.mode` 并保留 `tools.bash` 与未知字段。文件编辑模式加入常规草稿 fingerprint；配置刷新检测到模式变化时清理 context usage，因为 provider-visible tool schema 已变化，但不触发 transcript destructive replay。

替代方案是把字段放入 `ui`，但它影响 TUI 和 headless 的真实 runtime tool registry，不是纯展示偏好；放在 `tools` 域更符合现有 `tools.bash` 结构。

### 2. Registry 只注册所选文件编辑工具

`createDefaultToolRegistry` 根据归一化模式在 `createApplyPatchToolHandler` 和 `createEditFileToolHandler` 中二选一。所有 provider 继续只转换 registry definitions，不增加 adapter 分支；executor 也使用同一 registry，因此“模型可见 schema”和“实际可执行 handler”不会漂移。

```text
config ──▶ prepareAgent ──▶ default registry ──▶ provider definitions
                              │
                              └───────────────▶ tool executor

apply_patch mode: apply_patch ✓  edit_file ✗
edit_file mode:   apply_patch ✗  edit_file ✓
```

相比同时暴露两个工具再用 prompt 表达偏好，该方案行为确定、减少 schema token，并避免模型忽略偏好。一次 run 初始化后固定 registry；watcher 或 `/config` 保存只影响下一次 run，符合现有设置快照语义。

### 3. `edit_file` 使用原始字符串的精确、非重叠匹配

handler 对目标文件的原始 UTF-8 字符串使用确定性的 `indexOf` 等价语义：

1. 校验参数、路径、目标文件、大小和文本安全边界。
2. 拒绝空 `old_string` 与 `old_string === new_string`。
3. 在调用前 content 中收集 `old_string` 的非重叠匹配区间。
4. 零匹配失败；默认多匹配失败；`replace_all: true` 接受一个或多个匹配。
5. 从后向前替换已收集区间，确保插入内容不会参与本次再次匹配。
6. 验证 post-image 与 before 不同后才进入写盘。

匹配基于原始字符串，不自动归一化换行、空白或 Unicode normalization；这保持“精确替换”可预测，也避免无意改写未命中区域。工具描述和失败 hint 应要求模型在失败后重新读取并扩大上下文。CRLF 或混合换行文件只有在 `old_string` 与原始内容一致时匹配，这是第一版的明确取舍。

### 4. 执行器先模拟，再通过 change recorder 受控写盘

`edit_file` handler 使用独立职责模块承载参数解析、目标读取、匹配模拟、display projection 和写盘，避免把 search-and-replace 语义塞进 apply-patch parser。路径解析、`.git` 拒绝、UTF-8/NUL/大小检查等可抽取为真正共享的文件编辑边界；不为测试增加生产分支。

写盘顺序为：

```text
read + validate
      │
      ▼
simulate replacement ──失败──▶ ok:false，无写盘
      │
      ▼
captureFileBefore(path)
      │
      ▼
writeFileSync(postImage)
      │
      ▼
captureFileAfter(path) ───────▶ ok:true + display metadata
```

工具只处理一个已有文件，因此不存在跨文件原子性问题。写盘异常返回失败，只有真实成功后才调用 `captureFileAfter`；已捕获但未写入的 snapshot 保持 pending，不参与 `/undo`。

### 5. 泛化 display metadata，而不是让 edit_file 冒充 apply_patch

将当前 `ApplyPatchDisplayFile`/`ApplyPatchDisplayLine` 的结构性概念泛化为 `FileEditDisplayFile`/`FileEditDisplayLine`。metadata 的来源 discriminant 接受 `apply_patch` 与 `edit_file`，而 tool result details 仍明确区分两种工具：

```ts
type FileEditDisplayMetadata = {
  kind: 'apply_patch' | 'edit_file';
  files: FileEditDisplayFile[];
};
```

已有 JSON 中 `kind: "apply_patch"` 和原字段结构仍然有效。validator 需要校验 metadata kind 与 transcript record 的 tool name 一致，避免错误结果借用另一工具投影。

`edit_file` display projection 根据 before、post-image 和已定位 match spans 生成行级事实：行内替换显示完整 old line 为 removed、完整 new line 为 added；多行替换覆盖实际受影响的逻辑行；同一行的多个匹配先合并影响区间；远距离匹配保留多个修改区块。未变化的最终文件行作为带 1-based `postLine` 的 context，使 renderer 可以继续折叠长上下文而不读取磁盘。

相比对整个 before/after 只剥共同前后缀，基于 match spans 的投影不会把两个远距离替换之间的大段内容错误显示成删除再新增。

### 6. 把 renderer 提升为共享 file-edit renderer

现有 apply-patch result row 构造、折叠、预算和 ANSI 渲染迁移到工具无关的 file-edit renderer；apply-patch 和 edit-file 路由共用 result renderer，只保留不同的 call label parser：

```text
apply_patch call ──▶ apply_patch(path summary)
edit_file call   ──▶ edit_file(path)

valid success display ──▶ renderFileEditToolResultLines
missing/invalid display ─▶ generic result fallback
```

结果 renderer 继续只消费持久化 metadata，不读取当前文件、不重新执行匹配，也不改变 provider-facing result text。`edit_file` 失败结果使用有界通用失败投影；成功且 metadata 合法时隐藏冗余成功文本。旧 apply-patch 导出名可以暂时保留为兼容别名，或一次性更新内部引用和测试，但持久化 schema 必须兼容。

### 7. 风险分类使用共享“受控文件编辑工具”判定

risk classifier 增加 `isFileEditToolName` 或等价明确分支，使 `apply_patch` 与 `edit_file` 在 normal、plan 和 headless 下遵循相同策略。审批 preview 对 `edit_file` 只显示目标路径摘要，不展示可能很长或包含敏感内容的 old/new 字符串。会话级授权仍按实际 tool name 缓存，因此切换模式后不会把 `apply_patch` 授权扩张到 `edit_file`。

### 8. Change history 与 `/diff` 使用工具无关术语

`ChangeFileRecorder` 已与具体工具解耦，`edit_file` 直接复用即可。需要将 `/diff` fallback 的 label、notice 和注释从 `apply_patch history` 改为“受控文件编辑历史”，使同一 checkpoint 可聚合两种工具产生的文件状态。持久化结构无需增加 tool-name 字段，因为 `/undo` 和最终 diff 只依赖 before snapshot 与当前磁盘状态。

## Risks / Trade-offs

- [选择 `edit_file` 后不具备新增和删除文件能力] → 在工具描述和配置文案中明确“精确替换已有文件”；默认仍为功能完整的 `apply_patch`。后续若有需求，单独设计 create/delete 工具，不用空字符串引入隐式语义。
- [精确字符串在 CRLF、混合换行或模型上下文过期时匹配失败] → 保持失败不写盘并提供重新读取/扩大上下文 hint；不做可能误改文件的模糊回退。
- [`replace_all` 可能修改超出模型预期的位置] → 必须显式为 true，默认多匹配失败；审批 preview 标明 replace-all 和目标路径，结果报告实际数量。
- [行内替换的行级 diff 投影容易重复或吞并远距离区块] → 以执行阶段已知 match spans 生成并合并受影响行区间，针对同一行多匹配、多行替换和远距离替换增加纯函数测试。
- [泛化 metadata 破坏旧 session] → 保留 `kind: apply_patch` 与原 file/line 字段，validator 接受旧结构，并增加 resume 回归测试。
- [配置 UI 新增一行导致索引错位] → 移除散落的魔法索引或集中定义 general rows，覆盖移动、切换、保存与 dirty 状态测试。
- [工具 schema 切换后 context usage 仍显示旧估算] → 模式变化时清理 cached context usage，下一轮根据新 definitions 重新建立。

## Migration Plan

1. 先增加配置类型与默认回退，但保持默认 `apply_patch`，确保旧配置无行为变化。
2. 增加 `edit_file` handler、风险分类和 change recorder 集成，并通过 registry 选择逻辑仅在显式配置时启用。
3. 泛化 metadata 与 renderer，同时保留旧 apply-patch records 的 validator 和渲染回归测试。
4. 更新 `/config`、`/diff` 工具无关文案及相关 specs/tests。
5. 发布后用户可在 `/config` 中选择 `edit_file`；回滚只需将 `tools.fileEdit.mode` 改回 `apply_patch` 或删除该字段。

## Open Questions

- 无阻塞问题。新增/删除文件、批量多文件 edits 和换行归一化明确留待后续独立变更。
