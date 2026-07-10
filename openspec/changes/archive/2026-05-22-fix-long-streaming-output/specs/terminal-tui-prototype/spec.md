## ADDED Requirements

### Requirement: streaming pending preview 高度受限
系统 SHALL 在 assistant streaming 期间按当前 terminal rows 动态限制 pending preview 高度。长 draft 的 pending preview SHALL 给 divider、composer/hint 或 command surface 以及安全边距预留空间后，折叠头部并显示尾部内容，避免 footer 高度随完整 draft 无限增长并进入 terminal scrollback。

#### Scenario: 短 streaming draft 正常显示
- **WHEN** assistant streaming draft 按当前终端宽度投影后的行数不超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示完整 draft
- **THEN** footer pending preview SHALL 保持 streaming 前缀样式

#### Scenario: 长 streaming draft 折叠头部
- **WHEN** assistant streaming draft 按当前终端宽度投影后的行数超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示一行折叠提示
- **THEN** footer pending preview SHALL 只显示最新尾部内容
- **THEN** footer pending preview 的总行数 SHALL 不超过根据当前 terminal rows 与 footer 输入区高度计算出的动态预算

#### Scenario: streaming preview 折叠不改变最终 transcript
- **WHEN** assistant streaming draft 在 pending preview 中被折叠显示
- **THEN** 系统 SHALL 继续在内存中保留完整 assistant draft
- **THEN** assistant 完成后追加的 assistant transcript record SHALL 包含完整 draft，而不是折叠后的 preview 文本

### Requirement: resize recovery 覆盖终端行数压缩
系统 SHALL 在 terminal columns 变化或 terminal rows 变小时执行 destructive recovery。destructive recovery SHALL 基于当前 transcript、pending preview、composer 和 command surface 状态重绘完整 app snapshot，并清理 visible screen 与 scrollback，避免旧 footer/pending 行在快速压缩终端高度后残留为重复内容。

#### Scenario: streaming 期间快速缩小终端行数
- **WHEN** assistant streaming draft 正在 pending preview 中显示
- **AND** terminal rows 小于上一次成功渲染时记录的 rows
- **THEN** 系统 SHALL 执行 destructive recovery
- **THEN** 重绘后的 app snapshot SHALL 使用当前 rows 重新计算 pending preview 高度预算

#### Scenario: 仅增大终端行数
- **WHEN** terminal columns 未变化
- **AND** terminal rows 大于上一次成功渲染时记录的 rows
- **THEN** 系统 SHALL NOT 仅因为 rows 增大而执行 destructive recovery
- **THEN** 系统 SHALL 记录新的 terminal rows 供后续 resize 判断使用

## MODIFIED Requirements

### Requirement: footer 布局
系统 SHALL 渲染底部 footer。footer 由可选 pending preview 和当前输入 surface 组成：普通输入态的 surface 为 1 到 N 行 composer 和固定 1 行 hint；help overlay 态的 surface 为覆盖在 composer 区域的帮助内容和退出提示。assistant streaming pending preview SHALL 使用按 terminal rows 动态预算的尾部预览，避免长输出时 footer 高度无限增长。

#### Scenario: footer 显示 composer 和 hint
- **WHEN** 没有 pending assistant response，且 help overlay 未激活
- **THEN** footer SHALL 渲染 composer，并在其后渲染恰好 1 行 hint

#### Scenario: assistant 工作期间显示 pending preview
- **WHEN** assistant 正在 thinking 或 streaming，且 help overlay 未激活
- **THEN** footer SHALL 在 composer 和 hint 上方包含 pending preview

#### Scenario: streaming pending preview 保持有限高度
- **WHEN** assistant 正在 streaming 长 draft
- **THEN** footer SHALL 折叠 pending preview 的头部并显示尾部内容
- **THEN** footer SHALL NOT 因完整 draft 变长而把 pending preview 无限追加到 terminal scrollback

#### Scenario: composer 支持多行显示
- **WHEN** help overlay 未激活，且 composer 内容包含插入的换行，或因终端宽度发生 wrap
- **THEN** footer SHALL 为 composer 分配足够的行数，再渲染 hint 行

#### Scenario: help overlay 替换普通 composer surface
- **WHEN** help overlay 处于活跃状态
- **THEN** footer SHALL 使用 help overlay 内容替换普通 composer 与默认 hint 的显示区域
- **THEN** 帮助内容 SHALL 保持在 footer 临时区域内，而不是写入 transcript 历史区域
