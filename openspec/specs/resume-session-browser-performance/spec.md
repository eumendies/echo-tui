# resume-session-browser-performance Specification

## Purpose
TBD - created by archiving change optimize-resume-performance. Update Purpose after archive.
## Requirements
### Requirement: Resume 与 Reference 使用轻量索引打开会话列表
系统 SHALL 使用当前项目 schemaVersion 1 的轻量 session index 构造 `/resume` 与 `/reference` 左侧候选列表，并 SHALL 在 index 条目与 journal 指纹有效时避免读取或 replay 任意候选 journal 正文。候选 SHALL 按 updatedAt 倒序排列，并携带消息数量和从最终 records 派生的标题；`/reference` SHALL 排除当前 session，两个入口 SHALL 保留现有分页窗口和空状态语义。

#### Scenario: 有效 index 快速打开列表
- **WHEN** 用户打开 `/resume` 且当前项目的所有 journal 都有指纹匹配的有效 index 条目
- **THEN** 系统 SHALL 仅通过 index 和轻量文件状态构造左侧列表
- **THEN** 系统 SHALL NOT 为构造列表读取或 replay 任意 journal 正文

#### Scenario: 有效 index 快速打开引用列表
- **WHEN** 用户打开 `/reference` 且当前项目的所有 journal 都有指纹匹配的有效 index 条目
- **THEN** 系统 SHALL 仅通过 index 和轻量文件状态构造排除当前 session 的左侧列表
- **THEN** 系统 SHALL NOT 为候选标题或列表预览预先读取任意 journal 正文

#### Scenario: 当前项目没有 session
- **WHEN** 用户打开 `/resume` 且当前项目没有 `.jsonl` session journal
- **THEN** 系统 SHALL 显示现有可关闭空状态
- **THEN** 系统 SHALL NOT 启动预览加载

#### Scenario: 当前项目没有其他可引用 session
- **WHEN** 用户打开 `/reference` 且过滤当前 session 后没有候选
- **THEN** 系统 SHALL 显示现有可关闭空状态
- **THEN** 系统 SHALL NOT 启动预览加载

### Requirement: 选中会话预览按需加载
系统 SHALL 在 `/resume` 或 `/reference` 左侧列表 surface 已可渲染后，仅为当前选中的 session 异步加载有界右侧预览。预览加载 SHALL 使用 journal 的只读最终 replay 状态，并 SHALL NOT 修改当前 transcript、源 journal、当前 journal pointer 或 index 中的列表摘要。

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
- **THEN** 右侧 SHALL 显示该最终 session 中最近的有界 preview records
- **THEN** 被 truncate 移除的 records SHALL NOT 出现在预览中

#### Scenario: 选中项预览加载失败
- **WHEN** 当前选中 session 在按需读取期间无法读取或 replay
- **THEN** 右侧 SHALL 显示稳定的预览失败状态
- **THEN** 左侧其他候选和当前 transcript SHALL 保持不变

### Requirement: 快速导航不触发过期预览
系统 SHALL 对 `/resume` 与 `/reference` 连续列表移动触发的预览请求进行 120ms 短延迟合并，并 SHALL 使用命令 generation、active command 和 session 身份隔离迟到结果。只有仍属于发起预览的 active command session 及当前选中项的结果才能更新右栏。

#### Scenario: 连续移动只加载最终停留项
- **WHEN** 用户在防抖窗口内连续移动经过多个 session
- **THEN** 系统 SHALL 立即更新左侧选中项
- **THEN** 系统 SHALL 只为最终稳定停留的 session 启动预览读取

#### Scenario: 较早请求晚于当前请求完成
- **WHEN** session A 的预览请求启动后用户选择 session B
- **AND** session A 的结果晚于 session B 或当前选择返回
- **THEN** session A 的迟到结果 SHALL NOT 覆盖 session B 的右侧状态

#### Scenario: 关闭后预览完成
- **WHEN** 用户通过 Esc、Enter 或其他生命周期动作关闭 `/resume` 或 `/reference`
- **AND** 此前启动的预览请求随后完成
- **THEN** 迟到结果 SHALL NOT 重新打开或更新任何 command surface

### Requirement: 预览缓存有界且按 journal 指纹失效
系统 SHALL 在 `/resume` 与 `/reference` 之间共享最多 5 个 session 的有界 preview records，并 SHALL 使用 cwd、sessionId 与 journal 指纹区分缓存版本。系统 SHALL NOT 把完整 replay records 保存到 surface、command session data 或预览缓存。

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

### Requirement: 确认恢复继续验证完整 journal
系统 SHALL 在用户确认选中 session 时通过正式 session load 路径 replay 完整 journal，并只在加载成功后替换当前 transcript。index 或预览缓存 SHALL NOT 作为恢复内容的事实来源。

#### Scenario: 有预览后确认恢复
- **WHEN** 用户在右侧预览已显示后按 Enter
- **THEN** 系统 SHALL 通过正式 loadSession 路径验证并加载选中 journal
- **THEN** 恢复后的 records、状态和 journal reference SHALL 与完整 replay 结果一致

### Requirement: 确认引用继续只读验证完整 journal
系统 SHALL 在用户确认 `/reference` 候选时通过完整只读 session load 路径 replay journal，并只在加载成功后创建 pending 引用。index 标题、右栏预览或预览缓存 SHALL NOT 作为引用正文的事实来源，sourcePath SHALL 根据当前 cwd 与 sessionId 生成。

#### Scenario: 有预览后确认引用
- **WHEN** 用户在 `/reference` 右侧预览已显示后按 Enter
- **THEN** 系统 SHALL 完整只读 replay 选中 journal
- **THEN** pending 引用素材 SHALL 来自完整 replay 结果且当前 transcript SHALL 保持不变

#### Scenario: 引用候选完整加载失败
- **WHEN** 用户确认的引用候选无法通过完整只读 replay 验证
- **THEN** 系统 SHALL 显示稳定的引用失败状态
- **THEN** 系统 SHALL NOT 使用已有右栏预览创建 pending 引用

### Requirement: Resume Surface 在宽终端接近占满可用宽度
系统 SHALL 让 resume 双栏 renderer 在宽终端中使用接近完整的安全宽度，并 SHALL 在窄终端继续遵守最后一列安全边界和左右栏最小可读空间。

#### Scenario: 宽终端渲染历史会话浏览器
- **WHEN** resume 双栏 surface 的终端安全宽度至少为 64 列
- **THEN** box width SHALL 等于安全宽度减去 4 列水平边距
- **THEN** box width SHALL NOT 再受固定 118 列上限限制

#### Scenario: 窄终端渲染历史会话浏览器
- **WHEN** resume 双栏 surface 的终端安全宽度小于 64 列
- **THEN** renderer SHALL 使用完整安全宽度
- **THEN** 任意渲染行 SHALL NOT 超出终端安全宽度
