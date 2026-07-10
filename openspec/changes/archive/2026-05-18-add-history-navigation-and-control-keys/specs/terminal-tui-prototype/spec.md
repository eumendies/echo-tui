## ADDED Requirements

### Requirement: session 输入历史浏览
系统 SHALL 支持当前进程内的 session 输入历史浏览，用于在空 composer 状态下回看此前成功提交的用户输入。

#### Scenario: 空 composer 时向上进入历史浏览
- **WHEN** composer 为空，assistant 不处于 thinking 或 streaming，且用户按下 Up
- **THEN** 系统 SHALL 将 composer 内容切换为当前 session 中最近一次成功提交的用户输入
- **THEN** 系统 SHALL 进入历史浏览状态，以便后续 Up/Down 继续在历史记录中导航

#### Scenario: 历史浏览中继续向上查看更早输入
- **WHEN** 系统已经处于历史浏览状态，且用户再次按下 Up
- **THEN** 系统 SHALL 将 composer 切换为更早的一条历史输入
- **THEN** 当已经位于最早历史输入时，继续按 Up SHALL 保持在该条输入，不得越界

#### Scenario: 历史浏览中向下返回更新输入或空 composer
- **WHEN** 系统已经处于历史浏览状态，且用户按下 Down
- **THEN** 系统 SHALL 切换到更晚的一条历史输入
- **THEN** 当用户从最新历史输入继续按 Down 时，composer SHALL 被清空，且系统 SHALL 退出历史浏览状态

#### Scenario: response 活跃期间不得进入历史浏览
- **WHEN** assistant 正在 thinking 或 streaming，且 composer 为空时用户按下 Up 或 Down
- **THEN** 系统 SHALL NOT 进入历史浏览状态

#### Scenario: 只有成功提交的输入会进入历史
- **WHEN** 用户成功提交非空 composer 内容
- **THEN** 该次提交的原始输入 SHALL 被追加到当前 session 的输入历史中

## MODIFIED Requirements

### Requirement: composer 字符级编辑
系统 SHALL 支持 printable input 的字符级 composer 编辑，包括中文字符，并且不使用 `string.length` 作为光标模型。系统同时 SHALL 支持多行 composer 下的垂直移动，以及 readline 风格的 `Ctrl+A`、`Ctrl+E`、`Ctrl+U`、`Ctrl+K`、`Ctrl+W` 快捷编辑。

#### Scenario: printable 字符插入到光标位置
- **WHEN** 用户输入 printable 字符
- **THEN** 字符 SHALL 被插入到当前 composer 光标位置

#### Scenario: 中文字符作为一个编辑单元
- **WHEN** 用户输入中文字符，或在中文字符之间移动光标
- **THEN** composer SHALL 把该中文字符视为一个光标移动和编辑单元

#### Scenario: Backspace 删除前一个字符
- **WHEN** 用户按下 Backspace，且光标前至少有一个字符
- **THEN** composer SHALL 删除光标前的那个字符

#### Scenario: Delete 删除后一个字符
- **WHEN** 用户按下 Delete，且光标后至少有一个字符
- **THEN** composer SHALL 删除光标后的那个字符

#### Scenario: 左右方向键在边界内移动
- **WHEN** 用户按下 Left 或 Right
- **THEN** composer 光标 SHALL 向左或向右移动一个字符，并且不会移出内容边界

#### Scenario: 上下方向键在多行内容中垂直移动
- **WHEN** composer 中已有内容，且用户按下 Up 或 Down
- **THEN** composer 光标 SHALL 在相邻逻辑行之间垂直移动，并尽量保持原有逻辑列
- **THEN** 如果目标逻辑行长度不足，光标 SHALL 停在该行末尾

#### Scenario: Home 和 End 移动到当前逻辑行边界
- **WHEN** 用户按下 Home 或 End
- **THEN** composer 光标 SHALL 移动到当前逻辑行的开头或结尾

#### Scenario: Ctrl+A 和 Ctrl+E 移动到当前逻辑行边界
- **WHEN** 用户按下 Ctrl+A 或 Ctrl+E
- **THEN** composer 光标 SHALL 分别移动到当前逻辑行的开头或结尾

#### Scenario: Ctrl+U 删除到当前逻辑行开头
- **WHEN** 用户按下 Ctrl+U
- **THEN** composer SHALL 删除从当前逻辑行开头到光标前的内容

#### Scenario: Ctrl+K 删除到当前逻辑行结尾
- **WHEN** 用户按下 Ctrl+K
- **THEN** composer SHALL 删除从光标位置到当前逻辑行结尾的内容

#### Scenario: Ctrl+W 删除前一个词
- **WHEN** 用户按下 Ctrl+W
- **THEN** composer SHALL 先跳过光标前的连续空白，再删除前一个连续非空白片段

#### Scenario: Ctrl+J 插入换行
- **WHEN** 用户按下 Ctrl+J
- **THEN** composer SHALL 在光标位置插入换行，而不是提交消息
