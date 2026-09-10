## ADDED Requirements

### Requirement: footer 帧级增量重绘
系统 SHALL 在无 transcript 追加内容的 footer 重绘路径中执行帧级增量重绘:与上一帧逐行比较,内容未变的行 SHALL NOT 被清理或重写,内容变化的行 SHALL 原位覆写(先写新行再清理行尾残余,而非先清整行再重写),帧高变化 SHALL 只处理增量行(尾部追加新行或清理底部多余行)。该增量重绘 SHALL 保持单次 write 批量输出,SHALL NOT 改变光标定位语义、footer 高度上限、destructive recovery 或 transcript 追加路径的整帧重绘行为。增量记忆 SHALL 在任何破坏性重绘(清屏重建、退出清理)后重置。

#### Scenario: 未变行不触碰终端
- **WHEN** footer 重绘时新帧与上一帧存在内容完全相同的行(如 status line、composer 边框、pending 预览)
- **THEN** 系统 SHALL NOT 对这些行输出清理或重写序列
- **THEN** 光标 SHALL 跳过这些行继续处理后续变化行

#### Scenario: 变化行原位覆写
- **WHEN** 新帧某行内容与上一帧对应行不同(如 composer 输入行)
- **THEN** 系统 SHALL 在该行原位先写新内容再清理行尾残余,而不是先清整行再重写

#### Scenario: 帧高增高只追加增量行
- **WHEN** 新帧行数多于上一帧(如 composer 换行、slash 建议出现)
- **THEN** 系统 SHALL 保留与上一帧内容相同的行,只在尾部追加新行

#### Scenario: 帧高降低只清理增量行
- **WHEN** 新帧行数少于上一帧(如 slash 建议消失)
- **THEN** 系统 SHALL 保留与上一帧内容相同的行,只清理底部多出来的旧行

#### Scenario: 增量序列保持单次批量输出
- **WHEN** footer 执行帧级增量重绘
- **THEN** 系统 SHALL 将全部光标定位、覆写与清理序列合并为一次 write 输出

#### Scenario: transcript 追加路径保持整帧重绘
- **WHEN** footer 重绘伴随新的 transcript block 追加
- **THEN** 系统 SHALL 按现有整帧策略先移除旧帧、追加内容、再重绘新帧
- **THEN** 该路径 SHALL NOT 强制套用行级 diff

## MODIFIED Requirements

### Requirement: footer 重绘和光标恢复
系统 SHALL 在执行整帧重绘或帧高发生变化的 footer 重绘时隐藏光标,并在重绘结束后按当前输入 surface 恢复合适的光标状态:普通输入态恢复到 composer 逻辑位置并重新显示,command surface 态按 surface 需求决定是否显示光标。帧高不变的帧级增量重绘 SHALL NOT 额外引入光标隐藏与恢复序列,避免重置终端光标闪烁相位。

#### Scenario: 整帧或帧高变化的重绘先隐藏光标
- **WHEN** footer renderer 执行整帧重绘,或帧高发生变化的增量重绘
- **THEN** 它 SHALL 在清理和绘制 footer 行之前输出 hide cursor

#### Scenario: 帧高不变的单行增量覆写不重复隐藏光标
- **WHEN** 帧级增量重绘中帧高不变且仅单行内容原位覆写
- **THEN** 系统 SHALL NOT 为该次重绘追加 hide cursor 与 show cursor 包裹序列
- **THEN** 光标 SHALL 在覆写完成后仍定位到 composer 的逻辑位置

#### Scenario: 普通输入态回到 composer 编辑位置
- **WHEN** help overlay 未激活，且 composer 内容或光标状态发生变化
- **THEN** 可见终端光标 SHALL 在 footer 重绘后位于 composer 的逻辑光标位置
- **THEN** footer renderer SHALL 在定位完成后重新显示光标

#### Scenario: 不可编辑 command surface 活跃时保持光标隐藏
- **WHEN** info、select 或 confirm command surface 处于活跃状态并触发 footer 重绘
- **THEN** footer renderer SHALL NOT 在不可编辑 command surface 内容上显示可编辑光标
