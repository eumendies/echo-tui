## MODIFIED Requirements

### Requirement: footer 布局
系统 SHALL 渲染底部 footer。footer 由可选 pending preview、transcript/composer spacer 和当前输入 surface 组成：普通输入态的 surface 为顶满 terminal safe render width 的 boxed composer、可选 slash 命令提示列表和固定 1 行 segmented status line；command surface 态的 surface 为覆盖在 composer 区域的命令内容和自身提示。footer SHALL 底部贴底渲染：终端滚动区域覆盖内容区（顶部到 `rows - footer 高度`），footer 固定渲染在终端最后几行，footer 高度随 pending 变化时仅顶部移动，composer 与 status line SHALL 始终贴住 terminal 底部。assistant streaming pending preview SHALL 承载当前 segment 尚未成功写入可见 scrollback 的 draft 尾部（包括未稳定内容与等待 activity drain 的 queued source）：正文满足 Markdown 稳定边界的前缀、reasoning 最后一个视觉行之前的前缀通过 activity drain 增量确定到 terminal scrollback。footer pending preview SHALL 按对应正文/纯文本 renderer 展示尾部，并按 terminal rows 动态预算避免单个未闭合 Markdown 块或极端尾行使 footer 高度无限增长。

#### Scenario: footer 显示 boxed composer 和 status line
- **WHEN** 没有 pending assistant response，且 command surface 未激活
- **THEN** footer SHALL 渲染 boxed composer，并在其后渲染恰好 1 行 status line
- **THEN** boxed composer SHALL 使用当前项目的 `> ` 输入前缀
- **THEN** boxed composer SHALL 顶满当前 terminal safe render width
- **THEN** boxed composer 边框 SHALL NOT 显示 `Message` 或其他标题文字

#### Scenario: 空 composer 显示辅助 placeholder
- **WHEN** 普通 composer 可见且 composer 内容为空
- **THEN** boxed composer SHALL 在输入位置显示辅助 placeholder
- **THEN** placeholder SHALL 包含 `/` 命令入口、`Ctrl+J` 换行和 Enter 发送提示
- **THEN** placeholder SHALL NOT 写入 composer state、transcript 或 input history

#### Scenario: 非空 composer 隐藏 placeholder
- **WHEN** 普通 composer 可见且 composer 内容非空
- **THEN** boxed composer SHALL 显示真实 composer 内容
- **THEN** boxed composer SHALL NOT 同时显示 placeholder 文本

#### Scenario: footer 显示 slash 命令提示
- **WHEN** 没有 pending assistant response、help overlay 或 active command session，且 composer 内容是可提示的 slash 命令前缀
- **THEN** footer SHALL 在 boxed composer 和 status line 之间渲染 slash 命令提示列表
- **THEN** footer SHALL 保持 composer 光标可见并位于当前 composer 逻辑位置

#### Scenario: assistant 工作期间显示 pending preview
- **WHEN** assistant 正在 thinking 或 streaming，且 command surface 未激活
- **THEN** footer SHALL 在 boxed composer 和 status line 上方包含 pending preview

#### Scenario: streaming pending preview 只保留未确定尾部
- **WHEN** assistant 正在 streaming 长 Markdown draft，且当前 segment 已产生至少一个满足全部稳定条件的已完结块
- **THEN** 系统 SHALL 在 activity drain 时把该稳定 source 前缀增量确定到 terminal scrollback
- **THEN** footer pending preview SHALL 从 visible cursor 开始显示尚未成功 drain 的 Markdown-aware projection
- **THEN** footer SHALL NOT 因完整 draft 变长而把已完结内容无限追加或重复进入 terminal scrollback

#### Scenario: streaming table preview 只保留未完成 table 尾部
- **WHEN** assistant 正在 streaming 长 Markdown table draft
- **THEN** 系统 SHALL 把 table 之前满足全部稳定条件的块增量确定到 terminal scrollback
- **THEN** footer pending preview SHALL 使用 table-aware projection 展示未完成 table 尾部
- **THEN** footer SHALL NOT 因 table rows 增长而把已完结内容无限追加到 terminal scrollback

#### Scenario: composer 支持多行显示
- **WHEN** command surface 未激活，且 composer 内容包含插入的换行，或因终端宽度发生 wrap
- **THEN** footer SHALL 在 boxed composer 内为 composer 内容分配足够的行数，再渲染 status line 行
- **THEN** footer 重绘后的可见光标 SHALL 位于 boxed composer 内的当前 composer 逻辑位置

#### Scenario: command surface 替换普通 composer surface
- **WHEN** command surface 处于活跃状态
- **THEN** footer SHALL 使用 command surface 内容替换普通 boxed composer 与 status line 的显示区域
- **THEN** command surface 内容 SHALL 保持在 footer 临时区域内，而不是写入 transcript 历史区域

### Requirement: pending preview 高度受限
所有 pending preview SHALL 接受 footer 剩余高度预算。streaming pending 和 tool call pending 都 SHALL 在预算内渲染，不得因长文本、长 bash command 或长 tool arguments 绕过 footer 全局高度限制。streaming pending 的高度约束 SHALL 只作用于尚未 visibly committed 的尾部；已成功 drain 的 streaming projection 属于 terminal scrollback，不计入 footer 预算。

#### Scenario: 长 streaming pending 未确定尾部受限
- **WHEN** assistant streaming 未确定尾部渲染后仍超过 footer 剩余预算（例如单个未闭合超长块）
- **THEN** footer SHALL 只显示预算内的 streaming preview 行
- **THEN** footer SHALL 显示摘要或尾部内容以表达未确定尾部被裁剪

#### Scenario: 长 tool call pending 受限
- **WHEN** tool call pending 包含很长的 `run_bash_command` command 或很长的 arguments 文本
- **THEN** footer SHALL 只显示预算内的 tool call preview 行
- **THEN** footer layout 的总行数 SHALL 仍不超过 `rows - 2`

### Requirement: streaming pending preview 高度受限
系统 SHALL 在 assistant streaming 期间通过 activity drain 增量确定 source 前缀：正文使用 Markdown 稳定边界，reasoning 使用当前宽度下最后一个视觉行之前的边界。footer pending preview SHALL 承载尚未 visibly committed 的尾部；queued source 在成功 drain 前也 SHALL 保持可见。正文尾部 SHALL 使用 Markdown-aware（含 table-aware）projection，reasoning 尾部 SHALL 使用纯文本 projection；仅当正文单个未闭合块或极端 reasoning 尾行超过预算时，footer 才 SHALL 折叠其头部并显示尾部内容。系统 SHALL 继续在内存中保留当前 segment 完整 draft，并在完成时保证最终 transcript record 包含完整内容。

#### Scenario: 短 streaming draft 正常显示
- **WHEN** assistant streaming 未确定尾部按当前终端宽度投影后的行数不超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示完整未确定尾部的 Markdown-aware projection
- **THEN** footer pending preview SHALL 使用当前完整 record 投影在该 source 位置对应的 continuation 缩进与样式，不得重新开始第二个角色前缀

#### Scenario: 短 streaming table 正常显示
- **WHEN** assistant streaming 未确定尾部包含 table 且 table-aware projection 后的行数不超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示完整 table-aware projection
- **THEN** footer pending preview SHALL 使用当前完整 record 投影在该 source 位置对应的 continuation 缩进与样式

#### Scenario: 已完结块增量确定而非折叠
- **WHEN** assistant streaming draft 投影后的行数超过 preview 高度限制，且包含满足全部稳定条件的 Markdown 块
- **THEN** 系统 SHALL 把该稳定 source 前缀对应的新增投影增量确定到 terminal scrollback
- **THEN** footer pending preview SHALL 从 visible cursor 开始显示尚未成功 drain 的尾部，而不是折叠隐藏稳定内容

#### Scenario: 未闭合超长块折叠头部
- **WHEN** 单个尚未闭合的 Markdown 块按当前终端宽度投影后的行数超过 preview 高度限制
- **THEN** footer pending preview SHALL 显示一行折叠提示
- **THEN** footer pending preview SHALL 只显示该未确定块的最新尾部内容
- **THEN** footer pending preview 的总行数 SHALL 不超过根据当前 terminal rows 与 footer 输入区高度计算出的动态预算

#### Scenario: streaming 增量确定不改变最终 transcript
- **WHEN** assistant streaming draft 已把部分内容增量确定到 scrollback
- **THEN** 系统 SHALL 继续在内存中保留完整 assistant draft
- **THEN** assistant 完成后追加的 assistant transcript record SHALL 包含完整 draft，而不是仅剩余尾部

### Requirement: 普通交互只重绘 footer
系统 SHALL 在终端宽度不变的普通交互路径中只重绘 footer 区域。banner 和已提交 transcript 属于历史输出，不得在输入编辑、status line spinner 或 pending draft 更新时被再次追加到 terminal scrollback。作为例外，当前可见 projection owner 的 assistant streaming activity drain SHALL 允许在移除临时 footer 后追加新的已确定投影，再恢复 footer；该追加 SHALL 只包含本次 source cursor 差分，不得重放 banner、已提交 transcript block 或旧 footer 快照。

#### Scenario: 输入编辑时不重放 banner 和 transcript
- **WHEN** 用户输入字符、删除字符或移动 composer 光标，且 terminal columns 与上一次渲染相同
- **THEN** 系统 SHALL 只重绘 footer 中的 pending、transcript/composer spacer、composer 和 status line
- **THEN** 系统 SHALL NOT 重新输出 banner 或任何已提交 transcript block

#### Scenario: 未跨越确定边界的 pending 更新只重绘 footer
- **WHEN** assistant 进入 status line thinking spinner，或 streaming 未确定尾部发生变化但未产生新的已完结块，且 terminal columns 与上一次渲染相同
- **THEN** 系统 SHALL 只更新 footer 中的 pending preview、composer 和 status line
- **THEN** 系统 SHALL NOT 把旧 banner、旧 transcript projection 或旧 footer 快照再次写入 scrollback

#### Scenario: 跨越确定边界时追加已确定行
- **WHEN** assistant streaming 产生新的已完结 Markdown 块，且 terminal columns 与上一次渲染相同
- **THEN** 系统 SHALL 先移除当前 footer，再向 scrollback 追加新确定的 streaming 行，并在其后恢复 footer
- **THEN** 系统 SHALL NOT 重新输出 banner、已提交 transcript block 或旧 footer 快照

### Requirement: destructive resize recovery
系统 SHALL 在终端列宽变化或终端行数压缩时允许 destructive recovery：清可见屏幕、清 scrollback、回到左上角，并从当前状态完整重绘 app snapshot。当 streaming 进行中触发 recovery 时，完整快照 SHALL 按当前 width/theme 重投影尚未成为 transcript record 的 选定 replay boundary 之前的 in-flight source 与其后的 pending 尾部，不得复用旧宽度下的 rendered line count。

#### Scenario: 列宽变化时触发 destructive recovery
- **WHEN** 最新 terminal columns 不等于上一次 render 时记录的 columns
- **THEN** 应用 SHALL 进入 destructive recovery，而不是继续依赖旧输出物理行数估算来局部擦除

#### Scenario: 行数压缩时触发 destructive recovery
- **WHEN** 最新 terminal rows 小于上一次 render 时记录的 rows
- **THEN** 应用 SHALL 进入 destructive recovery，而不是继续依赖 footer 局部擦除

#### Scenario: 仅行数增大时不触发 destructive recovery
- **WHEN** terminal columns 未变化
- **AND** 最新 terminal rows 大于上一次 render 时记录的 rows
- **THEN** 应用 SHALL NOT 仅因为 rows 增大而执行 destructive recovery
- **THEN** 应用 SHALL 记录新的 terminal rows 供后续 resize 判断使用

#### Scenario: destructive recovery 清 screen 与 scrollback
- **WHEN** terminal columns 发生变化或 terminal rows 变小并触发 destructive recovery
- **THEN** 应用 SHALL 重置滚动区域与文本样式，清可见屏幕，清 scrollback，并把光标移动到左上角后再开始重绘

#### Scenario: destructive recovery 重绘完整快照
- **WHEN** terminal columns 发生变化或 terminal rows 变小并触发 destructive recovery
- **THEN** 新的可见屏幕 SHALL 包含 banner、transcript projection、按当前宽度重投影至选定 boundary 的 in-flight source、从该 boundary 开始的 pending preview、transcript/composer spacer、composer 和 status line 的完整当前快照

#### Scenario: destructive recovery 后光标回到 composer 逻辑位置
- **WHEN** 用户在输入、thinking 或 streaming 期间触发 terminal columns 变化
- **THEN** destructive recovery 完成后可见光标 SHALL 回到 composer 当前逻辑光标位置
