## ADDED Requirements

### Requirement: slash help overlay
系统 SHALL 支持一个最小版的本地 slash 帮助命令：当用户提交纯 `/help` 时，在 composer/footer 区域显示临时 help overlay，用于展示当前可用按键说明。

#### Scenario: 纯 /help 打开 help overlay
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/help`
- **THEN** 系统 SHALL 进入 help overlay 状态
- **THEN** 系统 SHALL 在 composer/footer 区域显示帮助内容，而不是把帮助文本追加到 transcript

#### Scenario: help overlay 不走 transcript、历史和 agent 生命周期
- **WHEN** 系统因纯 `/help` 进入 help overlay 状态
- **THEN** 系统 SHALL NOT 追加新的 user transcript record 或 assistant transcript record
- **THEN** 系统 SHALL NOT 把 `/help` 写入当前 session 的输入历史
- **THEN** 系统 SHALL NOT 启动 fake agent 的 thinking 或 streaming 生命周期

#### Scenario: Esc 关闭 help overlay
- **WHEN** help overlay 处于活跃状态且用户按下 Esc
- **THEN** 系统 SHALL 退出 help overlay 状态
- **THEN** 系统 SHALL 恢复普通 composer 输入界面，并让 composer 为空

## MODIFIED Requirements

### Requirement: footer 布局
系统 SHALL 渲染底部 footer。footer 由可选 pending preview 和当前输入 surface 组成：普通输入态的 surface 为 1 到 N 行 composer 和固定 1 行 hint；help overlay 态的 surface 为覆盖在 composer 区域的帮助内容和退出提示。

#### Scenario: footer 显示 composer 和 hint
- **WHEN** 没有 pending assistant response，且 help overlay 未激活
- **THEN** footer SHALL 渲染 composer，并在其后渲染恰好 1 行 hint

#### Scenario: assistant 工作期间显示 pending preview
- **WHEN** assistant 正在 thinking 或 streaming，且 help overlay 未激活
- **THEN** footer SHALL 在 composer 和 hint 上方包含 pending preview

#### Scenario: composer 支持多行显示
- **WHEN** help overlay 未激活，且 composer 内容包含插入的换行，或因终端宽度发生 wrap
- **THEN** footer SHALL 为 composer 分配足够的行数，再渲染 hint 行

#### Scenario: help overlay 替换普通 composer surface
- **WHEN** help overlay 处于活跃状态
- **THEN** footer SHALL 使用 help overlay 内容替换普通 composer 与默认 hint 的显示区域
- **THEN** 帮助内容 SHALL 保持在 footer 临时区域内，而不是写入 transcript 历史区域

### Requirement: footer 重绘和光标恢复
系统 SHALL 在重绘 footer 时隐藏光标，并在重绘结束后按当前输入 surface 恢复合适的光标状态：普通输入态恢复到 composer 逻辑位置并重新显示，help overlay 态保持光标隐藏。

#### Scenario: 光标仅在重绘期间隐藏
- **WHEN** footer renderer 执行重绘
- **THEN** 它 SHALL 在清理和绘制 footer 行之前输出 hide cursor

#### Scenario: 普通输入态回到 composer 编辑位置
- **WHEN** help overlay 未激活，且 composer 内容或光标状态发生变化
- **THEN** 可见终端光标 SHALL 在 footer 重绘后位于 composer 的逻辑光标位置
- **THEN** footer renderer SHALL 在定位完成后重新显示光标

#### Scenario: help overlay 活跃时保持光标隐藏
- **WHEN** help overlay 处于活跃状态并触发 footer 重绘
- **THEN** footer renderer SHALL NOT 在帮助内容上显示可编辑光标

### Requirement: 提交和响应锁
系统 SHALL 使用 Enter 提交输入区内容，并在 assistant response 活跃期间禁止第二次提交。纯 `/help` 属于本地命令，不启动 assistant 生命周期；其他带额外文本的输入仍按普通 user message 处理。

#### Scenario: Enter 提交非空普通内容
- **WHEN** 用户在 composer 内容非空、没有 active assistant response，且提交内容不精确等于 `/help` 时按下 Enter
- **THEN** 应用 SHALL 追加用户消息块、清空 composer，并启动 mock assistant response

#### Scenario: 纯 /help 进入本地帮助 overlay
- **WHEN** 用户在没有 active assistant response 时提交内容精确等于 `/help`
- **THEN** 系统 SHALL 进入 help overlay 状态，而不是启动 mock assistant response

#### Scenario: 带后缀文本的 /help 仍作为普通消息提交
- **WHEN** 用户提交内容以 `/help` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入 help overlay

#### Scenario: 空内容 Enter 不提交
- **WHEN** 用户在 composer 内容为空时按下 Enter
- **THEN** 应用 SHALL 保持 transcript 不变，并继续停留在当前输入模式

#### Scenario: response 进行中阻止新的提交与 slash 帮助
- **WHEN** assistant 正在 thinking 或 streaming
- **THEN** 按下 Enter SHALL NOT 启动另一个 assistant response
- **THEN** 提交纯 `/help` 也 SHALL NOT 进入 help overlay
