## MODIFIED Requirements

### Requirement: composer 字符级编辑
系统 SHALL 支持 printable input 的字符级 composer 编辑，包括中文字符，并且不使用 `string.length` 作为光标模型。系统同时 SHALL 支持多行 composer 下的垂直移动，readline 风格的 `Ctrl+A`、`Ctrl+E`、`Ctrl+U`、`Ctrl+K`、`Ctrl+W` 快捷编辑，以及按词移动光标和按词删除。

系统 SHALL 把词边界定义为「连续空白」与「连续非空白」之间的切换点。系统 SHALL NOT 在该规则之外推导语言相关的词边界；由空格分隔的语言与无空格分隔的语言 SHALL 遵循同一套切分规则。

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

#### Scenario: Ctrl+Left 或 Alt+Left 移动到前一个词边界
- **WHEN** 用户按下 Ctrl+Left 或 Alt+Left
- **THEN** composer 光标 SHALL 先跳过光标前的连续空白，再移动到前一个连续非空白片段的起始位置
- **THEN** 光标 SHALL NOT 越过内容开头

#### Scenario: Ctrl+Right 或 Alt+Right 移动到后一个词边界
- **WHEN** 用户按下 Ctrl+Right 或 Alt+Right
- **THEN** composer 光标 SHALL 先跳过光标后的连续空白，再移动到后一个连续非空白片段的结束位置
- **THEN** 光标 SHALL NOT 越过内容末尾

#### Scenario: Ctrl+Delete 或 Alt+Delete 删除后一个词
- **WHEN** 用户按下 Ctrl+Delete 或 Alt+Delete
- **THEN** composer SHALL 先跳过光标后的连续空白，再删除后一个连续非空白片段
- **THEN** 光标位置 SHALL 保持不变

#### Scenario: 按词删除与已确认文件引用保持坐标一致
- **WHEN** composer 中存在已确认的文件引用，且用户按词删除跨越该引用区间
- **THEN** 该引用的确认状态 SHALL 被撤销
- **THEN** 其余引用的起止坐标 SHALL 与删除后的文本保持一致

#### Scenario: 词级按键序列不被当作 cursor position report
- **WHEN** 系统收到 `ESC[1;5D`、`ESC[1;5C`、`ESC[1;3D`、`ESC[1;3C`、`ESC[3;5~` 或 `ESC[3;3~`
- **THEN** 系统 SHALL 分别产生对应的词级编辑事件
- **THEN** 系统 SHALL NOT 把它们当作 cursor position report 丢弃

#### Scenario: ESC 前缀按键映射到词级编辑
- **WHEN** 系统在同一个 stdin chunk 中收到 `ESC b`、`ESC f`、`ESC d` 或 `ESC DEL`
- **THEN** 系统 SHALL 分别产生「移动到前一个词」「移动到后一个词」「删除后一个词」「删除前一个词」事件
- **THEN** 系统 SHALL NOT 把其中的 ESC 单独解释为中断或取消事件
- **THEN** 系统 SHALL NOT 把其后的字母作为普通文本插入 composer

#### Scenario: ESC 前缀按键被拆包到达时仍能识别
- **WHEN** 单独到达的 `ESC` 与其后紧跟的字母落在相邻的两个 stdin chunk 中，且间隔在系统等待窗口内
- **THEN** 系统 SHALL 把它们合并为同一个 ESC 前缀按键事件

#### Scenario: 落单的 ESC 仍然产生中断语义
- **WHEN** 系统只收到一个孤立的 `ESC`，且等待窗口内没有后续字节到达
- **THEN** 系统 SHALL 产生 `escape` 事件，而不是任何词级编辑事件

#### Scenario: 真正的 cursor position report 仍被识别
- **WHEN** 系统收到形如 `ESC[<行>;<列>R` 的完整 cursor position report
- **THEN** 系统 SHALL 产生 `cursor_position` 事件，并携带解析后的行列坐标

#### Scenario: 未注册的 CSI 序列仍被静默丢弃
- **WHEN** 系统收到未在任何按键表中注册的 CSI 序列
- **THEN** 系统 SHALL NOT 把该序列的残留字符插入 composer
