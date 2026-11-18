## MODIFIED Requirements

### Requirement: Resume 与 Reference 使用轻量索引打开会话列表
系统 SHALL 使用当前项目 schemaVersion 1 的轻量 session index 构造 `/resume` 与 `/reference` 左侧候选列表，并 SHALL 在 index 条目与 journal 指纹有效时避免读取或 replay 任意候选 journal 正文。候选 SHALL 按 updatedAt 倒序排列，并携带消息数量和 index 中的会话标题；`/reference` SHALL 排除当前 session，两个入口 SHALL 保留现有分页窗口和空状态语义。

`/resume` 与 `/reference` 的左侧列表项 SHALL 只显示会话标题，把整列宽度让给可辨识内容。当前选中项的更新时间与消息条数 SHALL 显示在右栏标题行，格式为 `预览 · 更新时间 · N 条`；宽度不足时右栏标题按现有裁剪策略省略，SHALL NOT 挤占左侧标题列。

#### Scenario: 有效 index 快速打开列表
- **WHEN** 用户打开 `/resume` 且当前项目的所有 journal 都有指纹匹配的有效 index 条目
- **THEN** 系统 SHALL 仅通过 index 和轻量文件状态构造左侧列表
- **THEN** 系统 SHALL NOT 为构造列表读取或 replay 任意 journal 正文

#### Scenario: 有效 index 快速打开引用列表
- **WHEN** 用户打开 `/reference` 且当前项目的所有 journal 都有指纹匹配的有效 index 条目
- **THEN** 系统 SHALL 仅通过 index 和轻量文件状态构造排除当前 session 的左侧列表
- **THEN** 系统 SHALL NOT 为候选标题或列表预览预先读取任意 journal 正文

#### Scenario: 左侧列表项只显示标题
- **WHEN** 用户打开 `/resume` 或 `/reference` 且候选列表非空
- **THEN** 每个列表项 SHALL 只展示该会话的 index 标题
- **THEN** 列表项 SHALL NOT 展示更新时间或消息条数

#### Scenario: 选中项元数据显示在右栏标题
- **WHEN** 用户切换左侧选中项
- **THEN** 右栏标题行 SHALL 展示该选中项的更新时间与消息条数
- **THEN** 右栏标题宽度不足时 SHALL 省略自身内容
- **THEN** 左侧标题列宽度 SHALL NOT 因该元数据变化

#### Scenario: 当前项目没有 session
- **WHEN** 用户打开 `/resume` 且当前项目没有 `.jsonl` session journal
- **THEN** 系统 SHALL 显示现有可关闭空状态
- **THEN** 系统 SHALL NOT 启动预览加载

#### Scenario: 当前项目没有其他可引用 session
- **WHEN** 用户打开 `/reference` 且过滤当前 session 后没有候选
- **THEN** 系统 SHALL 显示现有可关闭空状态
- **THEN** 系统 SHALL NOT 启动预览加载
