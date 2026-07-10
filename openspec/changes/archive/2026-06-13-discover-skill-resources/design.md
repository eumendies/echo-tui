## Context

当前 skill 系统以 `.echo/skills/<name>/SKILL.md` 和 `~/.echo/skills/<name>/SKILL.md` 为唯一加载对象。catalog 只暴露 `name` / `description`，模型通过 `use_skill` 或 direct slash invocation 取回 `SKILL.md` 正文。这个机制简单且避免常驻长上下文，但当一个 skill 需要携带较长参考资料、示例、模板或辅助脚本时，只有正文显式写出路径，模型才知道这些文件存在。

这次变更只补齐“发现索引”：加载 skill 时返回同一 skill root 下附加资源的相对路径清单。它不改变工具权限、脚本执行、transcript schema 或上下文压缩生命周期。

## Goals / Non-Goals

**Goals:**

- 让模型在加载 skill 后能看到该 skill 包含哪些附加文件。
- 使用扁平清单格式输出资源路径：`- reference/foo.md`、`- scripts/bar.sh`。
- 保持 `use_skill` 和 `/<skill-name>` direct invocation 的加载文本一致。
- 保持 catalog 短小，只用于路由，不包含资源清单。
- 资源发现失败不影响 skill 本身加载。

**Non-Goals:**

- 不自动读取 `reference/` 文件内容。
- 不自动执行 `scripts/` 文件，不新增 script runner。
- 不新增 `load_skill_resource` 工具或 skill 专属资源读取权限。
- 不改变 bash 风险分类、tool approval 或 plan mode 工具集。
- 不兼容其它 agent 产品的完整 skill manifest 格式。

## Decisions

### Decision 1: 资源清单作为 `SkillDefinition` 的一部分

registry 在解析有效 `SKILL.md` 后扫描同一 skill 目录下的资源文件，并把结果放入 `SkillDefinition.resources`。这样 `use_skill` tool 和 direct slash invocation 都能复用同一份加载结果，不需要在两个入口重复文件系统扫描。

替代方案是在 `use_skill` handler 中临时扫描资源。该方案会让 direct slash invocation 另写一遍逻辑，增加两个入口输出不一致的风险。

### Decision 2: 输出扁平路径清单，不分组

加载文本追加一个 `[Skill Resources]` section，内容使用稳定排序的逐行路径清单：

```text
[Skill Resources]
- reference/checklist.md
- scripts/collect-diff.sh
```

理由：用户明确偏好第二种不分组描述；扁平格式最短，减少 tool result 噪音。路径本身已经携带 `reference/` 或 `scripts/` 前缀，足够表达资源位置。

替代方案是按目录分组输出。该方案可读性略高，但会引入额外标题并占用更多上下文；当前需求不需要。

### Decision 3: 只发现常规文件，使用相对路径

资源路径以 skill root 为基准，输出 POSIX 风格相对路径。扫描结果只包含普通文件，忽略目录、特殊文件和不可读目录。排序按路径字典序稳定输出，保证测试和 transcript 文本可预测。

替代方案是输出绝对路径。该方案对 `read_files` 可直接使用，但会把本机目录细节带入上下文，并使 user/project skill 在不同机器上的输出不稳定。相对路径配合 `source_path` 足以定位资源。

### Decision 4: 第一版扫描约定资源目录

第一版只扫描 skill root 下的 `reference/` 与 `scripts/` 目录。这样满足当前 “reference 或 script 附加内容” 的使用预期，同时避免把任意临时文件、状态文件或未来内部元数据都暴露给模型。

替代方案是扫描 skill root 下除 `SKILL.md` 外的所有文件。该方案更自动，但更容易泄露不想暴露的文件，也可能把 `skills.json` 等管理文件混入清单。

## Risks / Trade-offs

- [Risk] 资源清单变长会增加一次 `use_skill` tool result 的 token 占用。→ Mitigation：只输出路径，不输出内容；必要时可设置单 skill 资源数量或输出 bytes 上限并标记截断。
- [Risk] 相对路径需要模型结合 `source_path` 推断完整读取路径。→ Mitigation：现有 `use_skill` 输出已经包含 `source_path`，路径清单保持 skill-root-relative 语义并在测试中固定格式。
- [Risk] 扫描 `scripts/` 可能让模型更容易注意到脚本。→ Mitigation：本变更不增加任何执行能力；脚本若被运行仍走普通 bash 工具和现有审批路径。
- [Risk] 资源目录不可读或包含特殊文件。→ Mitigation：不可读资源目录只导致资源清单缺项，不让 skill 加载失败；只列普通文件。
