## MODIFIED Requirements

### Requirement: `/memory` 管理 command surface
系统 SHALL 提供 `/memory` 本地 slash command，并在同一管理流程中区分 user memory 与 agent memory。User memory 列表 SHALL 保留启停 toggle、截断预览、导航、新增、原地编辑和删除确认；agent memory SHALL 支持按 global/project scope 浏览 catalog、进入 item 列表、编辑 catalog 名称和描述，以及新增、编辑、启停和删除 catalog/item。Catalog 和 item 列表 SHALL 显示各自 enabled 状态，并 SHALL 使用 Space 切换选中对象；disabled 对象 SHALL 保留在管理列表中。该命令 SHALL NOT 触发 provider 请求或追加 transcript record。

#### Scenario: 选择 memory 类型
- **WHEN** 用户提交 `/memory`
- **THEN** 系统 SHALL 提供 user memory 与 agent memory 的可识别入口
- **THEN** 系统 SHALL NOT 将 `/memory` 提交给 agent

#### Scenario: 管理 user memory
- **WHEN** 用户进入 user memory 管理
- **THEN** 系统 SHALL 保留已有列表导航、Space 启停、新增、编辑、删除确认和 Esc 返回语义

#### Scenario: 浏览 agent catalog 和 item
- **WHEN** 用户进入 agent memory 管理
- **THEN** surface SHALL 显示 catalog 所属 global/project scope和 enabled 状态
- **THEN** 用户 SHALL 能进入选中 catalog 查看全部 enabled/disabled items
- **THEN** item 列表 SHALL 显示每个 item 的 enabled 状态

#### Scenario: 切换 agent catalog 状态
- **WHEN** 用户在 agent catalog 列表中对选中项按下 Space
- **THEN** 系统 SHALL 持久化相反的 enabled 状态
- **THEN** 当前 surface 和 `/memory` session cache SHALL 使用保存后的 catalog 列表更新

#### Scenario: 切换 agent item 状态
- **WHEN** 用户在 agent item 列表中对选中项按下 Space
- **THEN** 系统 SHALL 持久化相反的 enabled 状态并更新该 item 的 `updatedAt`
- **THEN** 当前 surface 和 `/memory` session cache SHALL 使用保存后的 item 列表更新

#### Scenario: 一级菜单统计全部 item
- **WHEN** `/memory` 显示 global/project agent memory item count
- **THEN** count SHALL 包含 enabled 和 disabled items

#### Scenario: 编辑 agent catalog 和 item
- **WHEN** 用户新增或编辑 agent catalog 元数据或 item 内容
- **THEN** surface SHALL 在 memory 卡片内使用可见真实终端光标维护草稿
- **THEN** 成功保存后 SHALL 刷新对应 catalog 或 item 列表

#### Scenario: 取消编辑不改变已保存数据
- **WHEN** 用户正在编辑任一 user/agent memory 草稿并按下 Esc
- **THEN** 系统 SHALL 丢弃未保存草稿并返回上一层列表
- **THEN** 已保存的 memory 文件 SHALL 保持不变

#### Scenario: 保存失败保留管理状态
- **WHEN** user 或 agent memory mutation 无法保存
- **THEN** 系统 SHALL 保持当前管理 surface 打开并显示可读错误
- **THEN** 编辑操作的未保存草稿 SHALL 保留供用户修正或取消
- **THEN** 启停失败 SHALL NOT 改变当前 surface 或 session cache 中的 enabled 状态
