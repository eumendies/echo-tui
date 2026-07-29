## MODIFIED Requirements

### Requirement: 文件 mention 提交上下文
系统 SHALL 在提交普通用户消息前解析 composer 中的文件或目录 mention，并将支持的文件内容、目录直接子项或 user attachments 加入 provider-facing user text。可见 transcript SHALL 保留用户原始输入；provider-facing 文本 SHALL 包含路径上下文说明。provider-facing `@` 上下文 SHALL 只保留对模型有用的路径、文件内容、目录直接子项、图片已附件化说明和读取/支持错误信息，不包含 verbose `read_files` metadata。系统 SHALL 对重复 mention 去重读取，但不得修改用户可见文本。受支持图片超过最终附件大小上限但未超过源文件安全上限时，系统 SHALL 按归一化的 `tools.readFiles.autoCompressImages` 设置决定生成压缩附件或返回失败。

#### Scenario: 文本文件加入上下文
- **WHEN** 用户提交的 composer 文本包含可读取文本文件 mention
- **THEN** 系统 SHALL 读取该文本文件并将其内容加入 provider-facing user text
- **THEN** 可见 transcript SHALL 显示用户原始 composer 文本
- **THEN** provider-facing user text SHALL 包含该文件路径和文本内容
- **THEN** provider-facing user text SHALL NOT 包含 `read_files` 的类型、大小、编码、截断状态、读取耗时或等价执行 metadata

#### Scenario: 目录直接子项加入上下文
- **WHEN** 用户提交的 composer 文本包含可读取目录 mention
- **THEN** 系统 SHALL 将该目录的有界直接子项加入 provider-facing user text
- **THEN** 系统 SHALL NOT 递归读取目录后代或自动读取子文件内容
- **THEN** provider-facing user text SHALL 包含目录路径和直接子项的可复用路径、类型及可用文件大小
- **THEN** provider-facing user text SHALL NOT 把成功目录错误标记为 unavailable
- **THEN** 当目录还有更多子项时，provider-facing user text SHALL 包含简洁的省略提示

#### Scenario: PDF 文件加入上下文
- **WHEN** 用户提交的 composer 文本包含可读取 PDF mention
- **THEN** 系统 SHALL 提取 PDF 文字并将提取文本加入 provider-facing user text
- **THEN** 系统 SHALL NOT 对 PDF 执行 OCR 或页面渲染

#### Scenario: 未超限图片文件作为模型图片输入
- **WHEN** 用户提交的 composer 文本包含受支持且未超过最终附件大小上限的图片 mention
- **THEN** 系统 SHALL 将该图片原始字节作为 provider-neutral user image attachment 附加到 user transcript record
- **THEN** provider-facing user text SHALL 说明该图片已作为附件提供
- **THEN** provider-facing user text SHALL 包含图片文件路径
- **THEN** provider-facing user text SHALL NOT 包含图片 base64 或原始二进制内容

#### Scenario: 自动压缩超限 mention 图片
- **WHEN** 用户提交的 composer 文本包含受支持图片 mention
- **AND** 图片超过最终附件大小上限但未超过源文件安全上限
- **AND** `tools.readFiles.autoCompressImages` 为 `true`
- **THEN** 系统 SHALL 在提交 user transcript record 前缩小并重新编码该图片
- **THEN** 系统 SHALL 只把不超过最终附件大小上限的压缩结果作为 user 图片附件
- **THEN** 附件 SHALL 保留原路径和媒体类型，并使用压缩结果的 Base64 与 size bytes
- **THEN** 可见 transcript SHALL 继续显示用户原始 composer 文本

#### Scenario: 关闭自动压缩时拒绝超限 mention 图片
- **WHEN** 用户提交的图片 mention 超过最终附件大小上限
- **AND** `tools.readFiles.autoCompressImages` 为 `false`
- **THEN** provider-facing user text SHALL 包含该路径和图片超限说明
- **THEN** 系统 SHALL NOT 为该图片生成附件

#### Scenario: 不支持或读取失败路径明确反馈
- **WHEN** 用户提交的 composer 文本包含不支持、不可读取、不存在、超过源文件安全上限或无法安全压缩的路径 mention
- **THEN** provider-facing user text SHALL 包含该路径的明确失败说明
- **THEN** provider-facing user text SHALL 包含失败路径和模型可理解的错误摘要
- **THEN** 系统 SHALL NOT 静默丢弃该 mention
- **THEN** 系统 SHALL NOT 为失败图片生成附件

#### Scenario: 重复 mention 去重读取
- **WHEN** 用户提交的 composer 文本多次引用同一路径
- **THEN** 系统 SHALL 最多读取和处理该路径一次
- **THEN** 可见 transcript SHALL 保留用户原始重复 mention 文本
