## MODIFIED Requirements

### Requirement: 选中会话预览按需加载
系统 SHALL 在 `/resume` 或 `/reference` 左侧列表 surface 已可渲染后，仅为当前选中的 session 异步加载右侧预览。预览记录 SHALL 覆盖该最终 session 的全部可见文本记录，记录数量 SHALL NOT 设上限；单条文本 SHALL 保持 500 字符截断，连续 subagent 运行 SHALL 折叠为单条摘要。预览加载 SHALL 使用 journal 的只读最终 replay 状态，并 SHALL NOT 修改当前 transcript、源 journal、当前 journal pointer 或 index 中的列表摘要。

#### Scenario: 首帧不等待预览
- **WHEN** `/resume` 已从 index 得到非空候选列表
- **THEN** 系统 SHALL 打开带左侧列表和右侧 loading 状态的 surface
- **THEN** 首次 surface 渲染 SHALL NOT 等待选中 journal 完成读取或 replay

#### Scenario: Reference 首帧不等待预览
- **WHEN** `/reference` 已从 index 得到非空候选列表
- **THEN** 系统 SHALL 打开带左侧标题列表和右侧 loading 状态的 surface
- **THEN** 首次 surface 渲染 SHALL NOT 等待选中 journal 完成读取或 replay

#### Scenario: 选中项预览加载成功
- **WHEN** 当前选中 session 的只读 journal replay 成功
- **THEN** 右侧 SHALL 显示覆盖该最终 session 全部可见文本记录的 preview records，记录数量 SHALL NOT 受 20 条上限约束
- **THEN** 被 truncate 移除的 records SHALL NOT 出现在预览中

#### Scenario: 选中项预览加载失败
- **WHEN** 当前选中 session 在按需读取期间无法读取或 replay
- **THEN** 右侧 SHALL 显示稳定的预览失败状态
- **THEN** 左侧其他候选和当前 transcript SHALL 保持不变

### Requirement: 预览缓存有界且按 journal 指纹失效
系统 SHALL 在 `/resume` 与 `/reference` 之间共享最多 5 个 session 的预览缓存，并 SHALL 使用 cwd、sessionId 与 journal 指纹区分缓存版本。缓存条目 SHALL 携带覆盖全部可见文本记录的 preview records，记录数量 SHALL NOT 以 20 条为界；单条文本 SHALL 保持 500 字符截断。系统 SHALL NOT 把未经预览投影的完整 replay records（含工具协议与 provider-private 原文）保存到 surface、command session data 或预览缓存。

#### Scenario: 重访未变化 session
- **WHEN** 用户重新选中一个已有预览缓存且 journal 指纹未变化的 session
- **THEN** 系统 SHALL 可直接使用缓存显示预览
- **THEN** 系统 SHALL NOT 再次读取该 journal 正文

#### Scenario: journal 已发生变化
- **WHEN** sessionId 相同但 journal size 或 mtime 与缓存 key 不同
- **THEN** 系统 SHALL 将旧缓存视为未命中
- **THEN** 系统 SHALL 重新只读加载当前 journal 预览

#### Scenario: 候选不属于当前 cwd
- **WHEN** 预览请求携带的候选 cwd 与当前 cwd 不一致
- **THEN** 系统 SHALL 拒绝加载或缓存该候选预览

## ADDED Requirements

### Requirement: 预览单行投影且面板高度自适应终端
系统 SHALL 将 `/resume` 与 `/reference` 右栏预览的每条 preview record 投影为单行摘要：首部 SHALL 携带 role 前缀，正文超出右栏安全宽度时 SHALL 以省略号截断，任一渲染行 SHALL NOT 超出右栏安全宽度。resume 双栏面板 SHALL 依据渲染层传入的 `maxLines` 行数预算自适应终端高度：面板主体高度 SHALL 等于 `maxLines` 减去固定外壳行数 6，未提供 `maxLines` 时主体 SHALL 保持 8 行。左栏候选窗口 SHALL 由渲染层按同一主体高度以选中项为中心投影，surface SHALL 携带完整候选列表与绝对选中索引；预览与左栏的滚动偏移上界钳制 SHALL 由渲染层在投影后执行，数据层 SHALL 仅保证偏移非负。

#### Scenario: 长消息单行截断
- **WHEN** 某条 preview record 的文本超过右栏安全宽度
- **THEN** 该记录 SHALL 渲染为单行摘要并以省略号截断
- **THEN** 任一渲染行 SHALL NOT 超出右栏安全宽度

#### Scenario: 高终端展开面板
- **WHEN** 终端行数较多且 footer 传入较大的 maxLines 预算
- **THEN** 面板主体高度 SHALL 等于 maxLines 减去固定外壳行数 6
- **THEN** 左栏候选窗口与右栏预览 SHALL 使用相同的主体高度投影

#### Scenario: 未提供高度预算
- **WHEN** renderer 被直接调用且未提供 maxLines
- **THEN** 面板主体高度 SHALL 保持现有 8 行默认值

#### Scenario: 预览滚动到底部
- **WHEN** 用户在预览焦点持续向下滚动，偏移超过最大滚动位置
- **THEN** 渲染层 SHALL 将可见窗口钳制在最后一个有效窗口
- **THEN** 预览 SHALL 能逐条遍历全部可见记录，不因数据层按消息条数计算的上界被截断

#### Scenario: 左栏窗口按主体高度投影
- **WHEN** 候选数量超过面板主体高度
- **THEN** 渲染层 SHALL 以选中项为中心投影可见窗口并显示上下更多提示
- **THEN** surface SHALL 携带完整候选列表与绝对选中索引，且 SHALL NOT 携带独立的隐藏数量字段
