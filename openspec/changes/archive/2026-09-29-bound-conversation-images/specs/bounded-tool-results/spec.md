## MODIFIED Requirements

### Requirement: 图片附件具有单项和聚合上限
`read_files` SHALL 默认限制单张最终图片不超过 3,000,000 bytes，并对一次调用返回的全部图片附件实施默认 6,000,000 bytes 聚合上限。超过剩余聚合预算的图片 SHALL NOT 进入 provider attachments。单次工具调用上限与会话级 provider 请求图片上限 SHALL 独立计算；调用方显式覆盖上限的现有能力 SHALL 保持不变。

#### Scenario: 多张图片累计超限
- **WHEN** 多张图片分别满足单图限制但累计超过 6,000,000 bytes
- **THEN** `read_files` SHALL 按请求顺序只附加预算内图片，并在文本结果中报告其余图片被跳过及结果已截断

#### Scenario: 图片自动压缩后满足预算
- **WHEN** 图片经自动压缩后同时满足单图上限和本次调用剩余聚合预算
- **THEN** 工具 SHALL 返回完整压缩附件并正确计入聚合大小

#### Scenario: 单图默认上限
- **WHEN** 图片最终附件超过 3,000,000 bytes 且自动压缩被关闭
- **THEN** `read_files` SHALL NOT 附加该图片，并 SHALL 报告图片超过单图大小上限

#### Scenario: 显式覆盖工具默认上限
- **WHEN** 工具调用方通过现有 handler 选项显式配置单图或单次调用图片上限
- **THEN** `read_files` SHALL 采用显式配置的有效上限，而不是强制使用默认值
