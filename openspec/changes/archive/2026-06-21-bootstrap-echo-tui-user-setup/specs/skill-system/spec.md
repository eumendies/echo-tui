## ADDED Requirements

### Requirement: 默认 setup skill 作为用户级 skill 发现
系统 SHALL 将 bootstrap 创建的 `echo-tui-setup` 作为普通用户级 skill 发现、展示、启用/禁用和加载。系统 SHALL NOT 为该 skill 新增 builtin source kind 或绕过现有 skill registry。

#### Scenario: 默认 setup skill 出现在 catalog
- **WHEN** bootstrap 已创建 `~/.echo/skills/echo-tui-setup/SKILL.md`
- **AND** 该 skill 未被用户级 `skills.json` 禁用
- **THEN** skill catalog SHALL 包含 `echo-tui-setup`
- **THEN** 该 catalog entry 的 `sourceKind` SHALL 为 `user`

#### Scenario: use_skill 加载默认 setup skill
- **WHEN** `use_skill` 收到 `{ "name": "echo-tui-setup" }`
- **THEN** 系统 SHALL 按用户级 skill 读取 `~/.echo/skills/echo-tui-setup/SKILL.md`
- **THEN** tool result SHALL 包含该 skill 的正文内容

#### Scenario: 项目级同名 skill 仍然覆盖用户级默认 skill
- **WHEN** 当前工作区存在 `.echo/skills/echo-tui-setup/SKILL.md`
- **AND** 用户目录也存在 bootstrap 创建的 `~/.echo/skills/echo-tui-setup/SKILL.md`
- **THEN** 系统 SHALL 使用项目级 skill 的元数据和内容
- **THEN** catalog SHALL 只包含一条 `echo-tui-setup` 记录

#### Scenario: /skills 可管理默认 setup skill
- **WHEN** 用户提交纯 `/skills`
- **AND** 默认 setup skill 是当前生效的用户级 skill
- **THEN** `/skills` surface SHALL 展示 `echo-tui-setup` 及其 enabled/disabled 状态
- **THEN** 用户保存状态时 SHALL 使用用户级 skill root 的 `skills.json`

