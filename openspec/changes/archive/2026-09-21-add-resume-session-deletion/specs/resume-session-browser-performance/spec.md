## ADDED Requirements

### Requirement: Resume 会话浏览器支持确认删除历史会话
系统 SHALL 在非空 `/resume` 会话浏览器中将 `d` 作为当前选中 session 的删除快捷键；该快捷键在列表或预览焦点下都针对同一选中项生效。对于非当前 session，系统 SHALL 在删除前切换至独立确认 surface，展示目标会话的可辨识标题、更新时间及不可恢复提示；确认 surface SHALL 使用 `Enter` 确认和 `Esc` 取消，且确认前不得修改持久化文件、当前 transcript 或会话列表。

#### Scenario: 按 d 打开删除确认
- **WHEN** 用户在 `/resume` 选中一个非当前持久化 session 并按下 `d`
- **THEN** 系统 SHALL 显示该 session 的删除确认 surface
- **THEN** 系统 SHALL NOT 在此时删除 journal、index 条目或 settings sidecar

#### Scenario: 取消删除返回浏览器
- **WHEN** 用户处于 `/resume` 删除确认 surface 并按下 `Esc`
- **THEN** 系统 SHALL 返回原会话浏览器而不删除目标 session
- **THEN** 系统 SHALL 为仍存在的原选中项恢复可用的预览 loading 或已加载状态
- **THEN** 系统 SHALL 恢复进入确认前的焦点与预览滚动位置

#### Scenario: 确认删除后刷新候选
- **WHEN** 用户在 `/resume` 删除确认 surface 按下 `Enter` 且持久化删除成功
- **THEN** 系统 SHALL 从存储重新读取 `/resume` 候选，而非仅修改旧的命令内存数组
- **THEN** 系统 SHALL 将选中索引钳制到仍存在的候选、将焦点设为列表，并仅在存在候选时加载新的选中项预览

#### Scenario: 删除最后一个候选
- **WHEN** 用户确认删除 `/resume` 中最后一个候选且删除成功
- **THEN** 系统 SHALL 显示既有可关闭的“没有可恢复会话”空状态
- **THEN** 系统 SHALL NOT 为不存在的候选启动预览加载

### Requirement: Resume 禁止删除当前正在使用的 session
系统 SHALL 不允许 `/resume` 删除当前 app 正在使用且持有 journal 写入 reference 的持久化 session。用户对该选中项按下 `d` 时，系统 SHALL 保持当前 transcript、journal 和浏览器候选不变，并显示稳定的中文说明；删除端口 SHALL 独立重复执行该保护，不得仅依赖 UI 检查。

#### Scenario: 尝试删除当前 session
- **WHEN** 用户在 `/resume` 选中当前正在使用的持久化 session 并按下 `d`
- **THEN** 系统 SHALL NOT 打开可执行删除的确认 surface
- **THEN** 系统 SHALL 显示当前会话不能删除的说明，且后续追加仍 SHALL 写入原 journal

### Requirement: 删除生命周期隔离异步预览
系统 SHALL 在进入 `/resume` 删除确认、取消确认、删除成功、删除失败或关闭浏览器时使不再适用的预览请求失效。只有仍属于当前 active `/resume` 浏览状态且对应当前选中 session 的预览结果才能更新右栏；已删除 session 的预览缓存 SHALL 被移除。

#### Scenario: 确认期间预览迟到完成
- **WHEN** 用户进入 session A 的删除确认前已启动 session A 或其他 session 的预览请求
- **AND** 该请求在确认 surface 显示后完成
- **THEN** 迟到结果 SHALL NOT 覆盖删除确认 surface 或恢复旧的浏览器状态

#### Scenario: 删除后旧预览迟到完成
- **WHEN** 用户确认删除 session A 并且 session A 的预览请求随后完成
- **THEN** 系统 SHALL NOT 显示 session A 的预览内容
- **THEN** 系统 SHALL NOT 将 session A 写回候选或预览缓存

### Requirement: 删除失败保留可理解的确认上下文
系统 SHALL 在用户确认后无法删除目标 session 时保留或恢复可理解的命令上下文，并以稳定中文文案提示失败、目标已不存在或当前 session 保护原因。系统 SHALL NOT 因删除失败加载、切换或清空当前 transcript，也不得删除其他 session。

#### Scenario: 确认时目标已被外部删除
- **WHEN** 用户打开 session A 的删除确认后，session A journal 在确认前被外部移除
- **AND** 用户按下 `Enter`
- **THEN** 系统 SHALL 提示目标已不存在或删除未完成
- **THEN** 系统 SHALL 保持当前 transcript 不变，并在用户返回浏览器后依据存储重新枚举候选
