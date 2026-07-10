## ADDED Requirements

### Requirement: skill 附加资源发现
系统 SHALL 在加载有效 skill 时发现该 skill root 下的附加资源文件，并在加载结果中提供稳定的扁平相对路径清单。资源清单 SHALL 只作为发现索引，不自动读取文件内容、不自动执行脚本、不改变工具审批或执行权限。

#### Scenario: 加载 skill 时包含资源清单
- **WHEN** skill root 下存在 `reference/checklist.md` 和 `scripts/collect-diff.sh`
- **AND** 用户或模型加载该 skill
- **THEN** 加载结果 SHALL 包含 `[Skill Resources]` 区块
- **THEN** 该区块 SHALL 包含 `- reference/checklist.md` 和 `- scripts/collect-diff.sh` 形式的扁平相对路径条目

#### Scenario: 没有资源时不输出空区块
- **WHEN** skill root 下不存在可发现的附加资源文件
- **AND** 用户或模型加载该 skill
- **THEN** 加载结果 SHALL 包含 skill 正文
- **THEN** 加载结果 SHALL NOT 包含空的 `[Skill Resources]` 区块

#### Scenario: catalog 不包含资源清单
- **WHEN** provider system prompt 注入 skill catalog
- **THEN** catalog SHALL 仍只包含 skill 名称和描述
- **THEN** catalog SHALL NOT 包含该 skill 的附加资源路径

#### Scenario: direct slash 调用包含同样资源清单
- **WHEN** 用户通过 `/<skill-name> [arguments...]` 直接调用带有附加资源的 enabled skill
- **THEN** 追加的 user transcript record SHALL 包含 skill 正文
- **THEN** 该 user transcript record SHALL 包含与 `use_skill` 加载结果等价的扁平资源路径清单

#### Scenario: 资源发现失败不影响 skill 加载
- **WHEN** 某个资源目录不可读或包含不可列出的条目
- **AND** `SKILL.md` 本身有效且可读取
- **THEN** 系统 SHALL 仍允许该 skill 出现在 catalog 并被加载
- **THEN** 系统 SHALL 跳过无法发现的资源，而不是让 skill 加载失败
