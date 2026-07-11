## ADDED Requirements

### Requirement: apply_patch 删除授权 preview
工具授权 permission gate SHALL 在 `apply_patch` 请求包含删除文件操作时显示明确的删除 preview。该 preview SHALL 使用轻量 patch header 扫描或等价机制生成，并 SHALL 只作为用户识别风险的展示信息；最终安全校验仍由 `apply_patch` handler 在执行阶段完成。

#### Scenario: Begin Patch 删除显示删除标记
- **WHEN** `apply_patch` 授权请求的 patch 包含 `*** Delete File: <path>`
- **THEN** permission gate SHALL 在 tool preview 中显示该路径
- **THEN** permission gate SHALL 使用 `delete <path>`、`- <path>` 或等价破坏性标记突出该文件会被删除
- **THEN** permission gate SHALL NOT 只以普通路径摘要展示该文件

#### Scenario: unified diff 删除显示删除标记
- **WHEN** `apply_patch` 授权请求的 patch 包含 `--- a/<path>` 到 `+++ /dev/null` 的删除文件语义
- **THEN** permission gate SHALL 在 tool preview 中显示该路径
- **THEN** permission gate SHALL 使用 `delete <path>`、`- <path>` 或等价破坏性标记突出该文件会被删除
- **THEN** permission gate SHALL NOT 只以普通路径摘要展示该文件

#### Scenario: 删除 preview 不改变授权决策语义
- **WHEN** `apply_patch` 删除授权 preview 显示在 permission gate 中
- **THEN** action 选项 SHALL 继续包含现有 allow、deny 和反馈选项
- **THEN** 用户选择任一选项后 SHALL 继续生成现有结构化授权决策
- **THEN** handler SHALL 在用户允许后重新执行完整解析、校验和写盘流程

#### Scenario: 删除 preview 遵守高度预算
- **WHEN** `apply_patch` 授权请求包含多个删除文件或很长路径
- **THEN** permission gate SHALL 继续遵守 footer 全局高度预算
- **THEN** preview SHALL 可被裁剪或摘要化
- **THEN** 被裁剪或摘要化时 SHALL 保留至少一个可见的删除标记或等价删除摘要
