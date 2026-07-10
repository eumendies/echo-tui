## ADDED Requirements

### Requirement: footer status line
系统 SHALL 在普通 composer footer 中使用 status line 替代静态 hint。status line SHALL 展示当前项目名、当前选择的模型、当前运行模式和当前上下文中不容易自然发现的操作提示；当前选择的模型 SHALL 作为最靠前的信息显示并使用区别于普通状态文本的强调颜色，并 SHALL 遵循现有终端宽度和 footer 局部重绘约束。

#### Scenario: 普通输入显示 idle status line
- **WHEN** 普通 composer 可见且没有 slash suggestion、pending preview 或 command surface
- **THEN** footer SHALL 在 composer 下方显示 status line
- **THEN** status line SHALL 优先显示当前选择的模型名称或等价模型标识
- **THEN** status line SHALL 使用区别于普通状态文本的强调颜色显示当前模型信息
- **THEN** status line SHALL 显示当前项目名
- **THEN** status line SHALL 显示 `idle` 或等价普通输入状态
- **THEN** status line SHALL 显示换行和命令入口等非显而易见操作提示
- **THEN** status line SHALL NOT 显示 Enter 发送这类基础输入提示

#### Scenario: slash suggestion 显示 command status line
- **WHEN** 普通 composer 正在显示 slash suggestion
- **THEN** status line SHALL 显示 command 或等价命令输入状态
- **THEN** status line SHALL 显示补全、上下选择和关闭建议相关快捷键提示

#### Scenario: pending 状态显示动态模式
- **WHEN** 当前 render state 包含 thinking、streaming 或 tool call pending
- **THEN** status line SHALL 显示对应的 thinking、streaming 或 tool 模式
- **THEN** tool call pending 模式 SHALL 包含工具名或等价工具标识
- **THEN** status line SHALL 显示退出相关操作提示

#### Scenario: 模型选择变化后 status line 更新模型信息
- **WHEN** 用户通过 `/model` 或等价机制切换当前模型
- **THEN** 后续普通 composer status line SHALL 显示新选中的模型名称或等价模型标识
- **THEN** status line SHALL NOT 显示旧模型信息

#### Scenario: command surfaces 保留自身提示
- **WHEN** footer 当前显示 info、select、confirm 或 choice command surface
- **THEN** 该 surface SHALL 继续使用自身的 `dismissHint` 或等价 surface 内提示
- **THEN** 全局 composer status line SHALL NOT 覆盖该 surface 的交互提示

#### Scenario: status line 遵循安全宽度
- **WHEN** terminal width 变窄或 status line 文本超过当前安全宽度
- **THEN** status line SHALL 被裁剪到 safe render width 内
- **THEN** status line SHALL NOT 因写满终端最后一列而触发额外自动换行

## MODIFIED Requirements

### Requirement: destructive resize recovery
系统 SHALL 在终端列宽变化或终端行数压缩时允许 destructive recovery：清可见屏幕、清 scrollback、回到左上角，并从当前状态完整重绘 app snapshot。

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
- **THEN** 新的可见屏幕 SHALL 包含 banner、transcript projection、pending preview、footer divider、composer 和 status line 的完整当前快照

#### Scenario: destructive recovery 后光标回到 composer 逻辑位置
- **WHEN** 用户在输入、thinking 或 streaming 期间触发 terminal columns 变化
- **THEN** destructive recovery 完成后可见光标 SHALL 回到 composer 当前逻辑光标位置

### Requirement: 终端 resize 渲染稳定性
系统 SHALL 在终端尺寸变化后保持布局稳定，并按当前宽度重新计算 transcript、pending preview、footer divider、composer 和 status line。

#### Scenario: resize 后分割线保持单行
- **WHEN** 终端宽度变窄或变宽并触发重绘
- **THEN** composer 上方的 footer divider SHALL 按当前终端宽度重新计算并保持 1 行显示，不得因为写满最后一列产生额外分割线行

#### Scenario: resize 后清理旧高度
- **WHEN** resize 前后的 transcript projection、pending preview、divider、composer 或 status line 总行数不同
- **THEN** renderer SHALL 选择合适的重绘方式：普通 redraw 或 destructive recovery，并保证新的可见布局正确

#### Scenario: 列宽变化后不残留旧输出
- **WHEN** 长消息或宽背景行在列宽变化后被终端重新折成不同的物理行数
- **THEN** destructive recovery 后的当前 screen SHALL NOT 残留重复 banner、重复 transcript、旧宽度灰底或多条 divider

#### Scenario: resize 后光标回到 composer 逻辑位置
- **WHEN** 用户在输入中 resize 终端
- **THEN** 重绘后可见光标 SHALL 回到 composer 当前逻辑光标位置

#### Scenario: streaming 中 resize 保持 pending 布局
- **WHEN** assistant thinking 或 streaming 期间发生 resize
- **THEN** pending preview、footer divider、composer 和 status line SHALL 按新宽度整体重绘，并保持相对顺序不变
