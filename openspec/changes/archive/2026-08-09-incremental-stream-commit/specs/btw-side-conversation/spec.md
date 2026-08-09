## MODIFIED Requirements

### Requirement: BTW 替换当前可见 transcript 投影
系统 SHALL 在进入 BTW 时 destructive repaint 为紧凑 BTW banner、side-only records 和 BTW footer，在退出时 destructive repaint 为最新主 banner、主 records、主 in-flight streaming projection 和主 footer。BTW 活跃期间 terminal projection owner SHALL 为 BTW；side 正文与 reasoning SHALL 使用与主会话相同的 Markdown/纯文本边界、per-segment cursor 和 activity drain 语义。系统 SHALL NOT 为每个 token destructive repaint，也 SHALL NOT 切换 alternate screen。

#### Scenario: 进入 BTW 切换全视图
- **WHEN** `/btw` 成功打开
- **THEN** renderer SHALL destructive repaint BTW 投影
- **THEN** 当前可见 transcript SHALL 不包含主 records 或主 in-flight streaming 行
- **THEN** BTW banner 或状态栏 SHALL 表明会话临时、readonly 且 Esc 返回主会话

#### Scenario: BTW 内稳定记录使用 append
- **WHEN** 活跃 BTW side turn 产生稳定 user、assistant、reasoning 或 tool record
- **THEN** renderer SHALL 清理 footer、append 对应现有 transcript block 并重绘 BTW footer
- **THEN** renderer SHALL NOT 因该稳定 record 清除全部 scrollback

#### Scenario: BTW streaming 增量确定并只在 footer 保留尾部
- **WHEN** 活跃 side turn 产生满足 Markdown 或 reasoning 视觉行边界的 source 前缀
- **THEN** 系统 SHALL 在 activity drain 时把新增投影 append 到 BTW scrollback
- **THEN** footer SHALL 从 side visible cursor 开始展示尚未成功 drain 的尾部
- **THEN** 系统 SHALL NOT 把未确定尾部提前提交为稳定 record

#### Scenario: BTW resize 恢复当前投影
- **WHEN** BTW 活跃期间终端列宽变化或行数缩小
- **THEN** renderer SHALL destructive replay BTW banner、全部 side records、当前 side in-flight source 至选定 replay boundary 的投影和最新 BTW footer
- **THEN** renderer SHALL 按新宽度重新投影 source
- **THEN** renderer SHALL NOT 错误重放主 transcript 或主 in-flight streaming 行

#### Scenario: BTW 活跃时后台主 streaming 不污染 side 投影
- **WHEN** BTW 活跃且后台主 turn 跨越新的稳定边界
- **THEN** 主 turn MAY 更新自身 in-flight state
- **THEN** renderer SHALL NOT 把主 turn 增量写入 BTW scrollback
- **WHEN** BTW 随后关闭
- **THEN** renderer SHALL destructive replay 最新主 records、主 in-flight source 至选定 replay boundary 的投影和主 pending tail

### Requirement: Esc 原子丢弃 BTW 并隔离迟到 callback
BTW command session 接收 Esc 时 SHALL 立即使当前 BTW conversation 和 side turn identity 失效，abort 仍运行的 side turn，丢弃全部 BTW records、draft、queued commit 与 committed source state，关闭 command session并恢复主投影。迟到的 side callback、activity tick、catch 或 finally SHALL NOT 追加 records、推进 cursor、重绘 BTW 或修改主状态；关闭 BTW SHALL NOT abort 后台主 turn。

#### Scenario: Side streaming 时 Esc
- **WHEN** side assistant 正在 streaming
- **AND** 用户按下 Esc且没有更高优先级 surface
- **THEN** 系统 SHALL abort side run并关闭整个 BTW 会话
- **THEN** 系统 SHALL 丢弃 partial side draft、queued commit、committed source state 和全部 BTW records
- **THEN** destructive repaint SHALL 移除已经写入 BTW scrollback 的 side 行并恢复主投影
- **THEN** 后台主 turn SHALL 继续运行

#### Scenario: 退出后的迟到 token 或 tick 被忽略
- **WHEN** BTW 已关闭并恢复主视图
- **AND** 旧 side provider callback 或 activity tick 随后到达
- **THEN** callback SHALL 因 conversation 或 turn identity 不匹配而被忽略
- **THEN** 主 transcript、主 cursor、主 footer 和 terminal 输出 SHALL 不包含该 callback 内容
