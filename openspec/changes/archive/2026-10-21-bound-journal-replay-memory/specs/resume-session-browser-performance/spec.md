## MODIFIED Requirements

### Requirement: 选中会话预览按需加载
系统 SHALL 在 `/resume` 或 `/reference` 左侧列表 surface 已可渲染后，仅为当前选中的 session 异步加载右侧预览。预览记录 SHALL 覆盖该最终 session 的全部可见文本记录，记录数量 SHALL NOT 设上限；单条文本 SHALL 保持 500 字符截断，连续 subagent 运行 SHALL 折叠为单条摘要。预览加载 SHALL 使用 journal 的只读最终 replay 状态，并 SHALL NOT 修改当前 transcript、源 journal、当前 journal pointer 或 index 中的列表摘要。预览加载 SHALL 按行读取 journal，SHALL NOT 额外保留完整文件副本（整文件字符串或等量的中间副本），其读取过程的常驻内存 SHALL 由读取缓冲、最大单行解析开销与重放期间的有效状态构成；预览加载 SHALL NOT 保留未参与预览投影的完整 replay records。读取 SHALL NOT 阻塞事件循环，使加载期间的导航、取消与其他输入保持可用。

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
- **THEN** 该失败 SHALL NOT 终止进程，也 SHALL NOT 以未捕获异常的形式逃逸到事件循环

#### Scenario: 大 journal 预览的读取内存特征
- **WHEN** 用户选中一个尺寸远大于预览投影结果的 session
- **THEN** 预览加载 SHALL NOT 以整文件为单位读取 journal 内容
- **THEN** 预览加载 SHALL NOT 为投影构造或保留完整文件副本
- **THEN** 读取期间事件循环 SHALL 保持可用：列表移动、Esc 取消与后台响应 SHALL NOT 被整份读取阻塞
