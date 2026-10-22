# conversation-image-budget Specification

## Purpose
定义单次 provider 请求的会话级图片附件预算、超限时的压缩与有界省略，以及不改写原始历史的投影语义。
## Requirements
### Requirement: 单次 provider 请求的会话图片总预算
系统 SHALL 对普通请求和压缩摘要请求中模型可见的 `user` 与 `tool_result` 图片附件合计实施默认 10,000,000 字节的原始二进制图片预算；预算 SHALL 跨多次工具调用、用户附图和恢复后的历史生效，不以 `read_files` 单次工具限额替代。当附件大小元数据缺失或不可信时，系统 SHALL 根据有效图片数据计算预算。只限制最终发给 provider 的图片附件，不得删改原会话记录。图片预算在请求形成前 SHALL 被执行，超预算附件 SHALL NOT 被发送。

#### Scenario: 多次 read_files 后图片累计超限
- **WHEN** 多次 `read_files` 的活跃图片分别满足单次工具预算，但本次 provider 请求合计超过会话图片预算
- **THEN** 本次 provider 请求 SHALL 只携带满足预算的图片附件
- **THEN** 本地历史 SHALL 保留所有读取到的图片附件

#### Scenario: 用户图片与工具图片共享预算
- **WHEN** 用户直接上传的图片与 `read_files` 图片合计超过请求预算
- **THEN** 两种来源 SHALL 一同计入预算，而不是分别获得完整预算

#### Scenario: 未超预算时完全保持历史投影
- **WHEN** 本次请求的活跃图片总量未超预算且上下文未触发压缩
- **THEN** 系统 SHALL NOT 为图片预算删除或改写模型可见历史附件与文本

### Requirement: 优先压缩、必要时有界省略历史图片
系统 SHALL 在图片感知的上下文估算触发自动压缩时优先按既有压缩边界生成摘要；若请求图片本身超过字节预算，系统 SHALL 在普通请求发出前尝试已有可用压缩边界，并在完成压缩后重新检查预算。压缩无有效边界、未被采纳或压缩后仍超预算时，系统 SHALL 为本次发送构造独立的有界历史副本，按时间从较新到较旧选择可以整体保留的图片，保持保留图片的原有顺序；无论哪种情况，发往 provider 的图片总字节 SHALL NOT 超过预算。系统 SHALL NOT 在预算未触发时逐轮固定裁剪图片。自动压缩失败的既有错误处理 SHALL NOT 被静默改写为压缩成功。

#### Scenario: 旧历史图片可经压缩移出活跃区间
- **WHEN** 图片预算超限，已有可压缩边界且完成压缩后活跃图片满足预算
- **THEN** 系统 SHALL 发送压缩摘要及未超限的活跃图片，SHALL NOT 再额外省略这些图片

#### Scenario: 最近图片即使压缩后仍超预算
- **WHEN** 活跃记录中图片仍超过预算或不存在有效压缩边界
- **THEN** 普通 provider 请求 SHALL 在发送副本中舍弃预算之外的图片，同时 SHALL 保留原始会话历史

#### Scenario: 单张图片超过请求预算
- **WHEN** 一张待发送图片自身超过总预算
- **THEN** 系统 SHALL 不发送该图片，不得以图片不可分割为由放宽请求预算

### Requirement: 省略提示和工具历史完整性
图片因预算被省略时，系统 SHALL 在对应模型可见记录的发送副本中标注本次未附带图片，避免模型仅看到历史 `image_attached: true` 而误以为仍可观察像素。系统 SHALL 保留原文本、调用 ID、tool call/result 配对、消息顺序及 provider 私有 reasoning 记录的投影规则；对带路径的工具图片 SHALL 提示可重新调用 `read_files` 获取像素，对无可用路径的用户图片 SHALL NOT 虚构可重读路径。历史/磁盘上的记录 SHALL 不变，session prompt cache key SHALL 不因预算策略改变；系统 SHALL NOT 承诺省略后缓存仍命中。

#### Scenario: 图片工具结果被省略但保留文本和调用关系
- **WHEN** 某个 `read_files` 工具结果中的一张图片超过本次预算
- **THEN** 发送的 `tool_result` SHALL 保留其文字说明和原 toolCallId，并注明该图片本次未附带及可重读路径
- **THEN** 对应的 `tool_call` SHALL 仍与该 `tool_result` 配对

#### Scenario: 用户附图缺少可重读路径
- **WHEN** 被省略的是未关联本地路径的用户上传图片
- **THEN** 发送副本 SHALL 说明本次未附带该图片，SHALL NOT 提示可通过未知文件路径重新读取

#### Scenario: 恢复旧会话继续提问
- **WHEN** 恢复已有大量历史附图的会话后再发起 provider 请求
- **THEN** 系统 SHALL 仅在本次发送副本实施相同图片预算，原持久化记录及其可见 UI 历史 SHALL 保持不变
