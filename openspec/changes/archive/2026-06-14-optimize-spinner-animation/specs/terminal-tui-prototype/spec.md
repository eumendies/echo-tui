## ADDED Requirements

### Requirement: echo 主题 spinner 动画
系统 SHALL 在 status line 中原 ready/PLAN 所在状态段显示 assistant thinking/working 的 echo 主题固定宽度声场 spinner 动画。该动画 SHALL 由多个 cell 组成，表现为从中心向两侧扩散、淡出并短暂停顿的回声波纹。动画 SHALL 继续由 `elapsedMs` 在渲染层纯投影生成，不依赖后台线程、独立终端行控制或第三方 TUI 库。

#### Scenario: 非响应中保留 ready/PLAN
- **WHEN** assistant 未处于 thinking 或 working 响应状态
- **THEN** status line 状态段 SHALL 继续显示既有 ready 或 PLAN
- **THEN** 系统 SHALL NOT 显示 echo spinner

#### Scenario: thinking 在 status line 使用 echo spinner
- **WHEN** assistant 处于 thinking pending 状态
- **THEN** status line 状态段 SHALL 显示 echo 主题声场 spinner 和 thinking 文案，而不是 ready 或 PLAN
- **THEN** thinking 文案 SHALL 使用灰色未扫区域、白色过渡区域和 bold white 主扫光，并显示从文案中心向两侧扩散的扫光
- **THEN** thinking 文案扫光 SHALL 复用 echo spinner 的完整帧周期；当 spinner 处于空白暂停帧时，文案 SHALL 不显示白色扫光
- **THEN** status line SHALL NOT 在 thinking spinner 状态段后追加响应中 key hint，例如 `Ctrl+C 退出`
- **THEN** pending preview SHALL NOT 为 thinking 额外显示独立 spinner 行
- **THEN** pending preview SHALL NOT 在 thinking 动画前额外显示 assistant message prefix，例如 `◇ `

#### Scenario: working 在 status line 使用同一套 echo spinner
- **WHEN** assistant 已进入 working 状态
- **THEN** status line 状态段 SHALL 显示与 thinking 相同风格的 echo 主题声场 spinner
- **THEN** status line 状态段 SHALL 显示 working 文案和 elapsed time
- **THEN** working 文案和 elapsed time SHALL 使用灰色未扫区域、白色过渡区域和 bold white 主扫光，并显示从文案中心向两侧扩散的扫光
- **THEN** working 文案扫光 SHALL 复用 echo spinner 的完整帧周期；当 spinner 处于空白暂停帧时，文案 SHALL 不显示白色扫光
- **THEN** status line SHALL NOT 在 working spinner 状态段后追加响应中 key hint，例如 `Ctrl+C 退出`
- **THEN** footer SHALL NOT 为 working 额外显示独立行

#### Scenario: spinner 帧宽稳定
- **WHEN** spinner 随 `elapsedMs` 推进到不同帧
- **THEN** 每一帧的 plain text 显示宽度 SHALL 保持一致
- **THEN** ANSI 着色 SHALL NOT 改变 status line 的宽度计算
- **THEN** footer SHALL NOT 因 spinner 帧变化出现水平抖动或额外换行

#### Scenario: spinner 使用 cyan 强弱层次
- **WHEN** echo spinner 渲染非空 cell
- **THEN** cell SHALL 使用 cyan 色系或等价项目 accent 色系表达强弱变化
- **THEN** 更强的 cell SHALL 比更弱的 cell 更亮或更醒目
- **THEN** 空白 cell SHALL 保持空白，不输出会污染后续文本的未闭合 ANSI 样式

#### Scenario: spinner 不改变响应生命周期
- **WHEN** assistant thinking、streaming、tool call、complete、error 或 interrupt 状态发生变化
- **THEN** spinner 动画 SHALL 只影响可见渲染
- **THEN** 系统 SHALL 保持既有 response lock、pending state、footer redraw、transcript append 和 session persistence 语义不变

### Requirement: transcript/composer 空行分隔
系统 SHALL 使用一行语义空行分隔 transcript 与 composer 输入区，而不是在 composer 上方渲染额外实线 divider。该空行 SHALL 继续计入 footer 高度预算和光标定位计算。

#### Scenario: composer 使用自身边框完成视觉分隔
- **WHEN** footer 渲染 composer 输入区
- **THEN** transcript 与 composer 之间 SHALL 存在一行空白 spacer
- **THEN** composer 上方 SHALL NOT 渲染额外实线 divider
