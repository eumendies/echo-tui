## MODIFIED Requirements

### Requirement: footer semantic theme token
系统 SHALL 使用 semantic theme token 表达 TUI 可配置颜色，而不是让 renderer 直接依赖固定 cyan 命名。默认 token 值 SHALL 保持当前 footer、transcript block、banner、Markdown 和 syntax highlight 的默认视觉。

#### Scenario: 默认 token 覆盖 footer 共享视觉语义
- **WHEN** 默认 render theme 生效
- **THEN** theme SHALL 为 footer 提供 accent、accentStrong、accentDeep、frame、text、muted、success、warning、danger、selectionBackground、codeBackground 和 codeForeground 或等价语义 token
- **THEN** footer renderer SHALL 使用这些 token 表达标题、边框、焦点条、active 文本、弱化文本、状态 marker、警告、错误、active row 和 code-like 内容

#### Scenario: 默认 token 覆盖 block 和 Markdown 视觉语义
- **WHEN** 默认 render theme 生效
- **THEN** theme SHALL 为 blocks、Markdown 和 syntax highlight 提供 banner、user、assistant、pending、error、notice、reasoning、shell、tool、heading、list marker、blockquote、rule、table、inline code、inline math 和 syntax token 或等价语义 token
- **THEN** render 层 SHALL 使用这些 token 表达 transcript block、pending preview、banner、assistant Markdown 和 fenced code block 的可配置视觉

#### Scenario: 用户覆盖部分 token
- **WHEN** `theme.json` 只配置部分 render theme token
- **THEN** 已配置且有效的 token SHALL 覆盖默认值
- **THEN** 未配置 token SHALL 继续使用默认 render theme 值

#### Scenario: 局部无效 token 回退默认值
- **WHEN** `theme.json` 中某个 render theme token 的颜色格式无效或超出允许范围
- **THEN** 系统 SHALL 忽略该 token
- **THEN** 该 token SHALL 使用默认 render theme 值
- **THEN** 其他有效 token SHALL 仍然生效

#### Scenario: theme color 不支持 raw sgr
- **WHEN** `theme.json` 中某个颜色使用 `{ "sgr": number }`
- **THEN** 系统 SHALL 将该颜色视为无效 token
- **THEN** 该 token SHALL 使用默认 render theme 值
