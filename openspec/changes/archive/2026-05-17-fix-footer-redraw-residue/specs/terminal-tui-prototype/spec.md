## ADDED Requirements

### Requirement: 普通交互只重绘 footer
系统 SHALL 在终端宽度不变的普通交互路径中只重绘 footer 区域。banner 和已提交 transcript 属于历史输出，不得在输入编辑、thinking spinner 或 pending draft 更新时被再次追加到终端 scrollback。

#### Scenario: 输入编辑时不重放 banner 和 transcript
- **WHEN** 用户输入字符、删除字符或移动 composer 光标，且 terminal columns 与上一次渲染相同
- **THEN** 系统 SHALL 只重绘 footer 中的 pending、composer、divider 和 hint
- **THEN** 系统 SHALL NOT 重新输出 banner 或任何已提交 transcript block

#### Scenario: spinner 或 pending 更新时不重放历史区域
- **WHEN** assistant 进入 thinking spinner，或 streaming draft 发生变化，且 terminal columns 与上一次渲染相同
- **THEN** 系统 SHALL 只更新 footer 中的 pending preview、composer 和 hint
- **THEN** 系统 SHALL NOT 把旧 banner、旧 transcript projection 或旧 footer 快照再次写入 scrollback

### Requirement: transcript 追加前清理临时 footer
系统 SHALL 在向终端追加新的 transcript block 之前先移除临时 footer，再在追加完成后恢复 footer，以保持 transcript append-only 和 footer 临时区的边界清晰。

#### Scenario: 用户提交时先清 footer 再追加用户消息
- **WHEN** 用户提交非空 composer 内容
- **THEN** 系统 SHALL 先移除当前 footer
- **THEN** 系统 SHALL 只向终端追加一个新的 user transcript block
- **THEN** 系统 SHALL 在该 block 之后重新绘制 footer

#### Scenario: assistant 完成时先清 footer 再追加正式回复
- **WHEN** assistant 完成 streaming 并提交最终回复
- **THEN** 系统 SHALL 先移除当前 footer
- **THEN** 系统 SHALL 只向终端追加一个新的 assistant transcript block
- **THEN** 系统 SHALL 在该 block 之后重新绘制 footer

### Requirement: destructive full replay 仅用于需要重建快照的场景
系统 SHALL 只在必须重建完整快照的场景中执行 banner、transcript 和 footer 的 full replay，例如 resize destructive recovery 或退出前最终静态输出。

#### Scenario: resize 时允许完整重放当前快照
- **WHEN** terminal columns 发生变化
- **THEN** 系统 SHALL 进入 destructive recovery，并基于 transcript records 和当前 footer state 重放完整快照

#### Scenario: 宽度不变时不得使用 full replay 处理普通编辑
- **WHEN** 普通输入、spinner 或 pending 更新发生，且 terminal columns 没有变化
- **THEN** 系统 SHALL NOT 走完整 app snapshot 的 clear + replay 路径
