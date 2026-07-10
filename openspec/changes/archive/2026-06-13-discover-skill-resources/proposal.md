## Why

当前 skill 系统只会按需加载 `SKILL.md` 正文；如果 skill 目录中存在辅助参考资料或脚本，模型只有在正文手写路径时才可能发现它们。为支持更完整的 skill 包结构，需要在加载 skill 时暴露附加内容的路径索引，同时避免自动读取或执行导致上下文膨胀和语义复杂化。

## What Changes

- skill registry 在发现有效 `SKILL.md` 时，同时发现同一 skill root 下的附加资源文件。
- `use_skill` 加载结果在 skill 正文后追加扁平的资源路径清单，格式为逐行 `- <relative-path>`，不按 `reference` / `scripts` 分组。
- direct slash skill invocation 注入的 user message 同样包含该扁平资源清单，保持两种加载入口一致。
- 资源清单只作为发现索引，不自动读取文件内容、不执行脚本、不新增权限或审批语义。
- skill catalog 仍只包含名称和描述，不包含资源清单。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `skill-system`: 扩展 skill 内容加载行为，使加载结果包含 skill root 下附加资源的扁平路径清单。

## Impact

- 影响 `src/skills/skill-registry.ts` 的 skill 发现与加载结果结构。
- 影响 `src/types/skill.ts` 的 skill 定义类型。
- 影响 `src/tools/use-skill-tool-handler.ts` 与 `src/app/command-host.ts` 的 skill 加载文本格式。
- 影响 skill 相关测试和文档；不需要新增第三方依赖，不改变 transcript schema、tool approval、bash 风险分类或 provider adapter 协议。
