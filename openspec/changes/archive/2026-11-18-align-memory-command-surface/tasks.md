## 1. 类型与行投影基础

- [x] 1.1 把 `MemoryCommandSection` 改为 `'types' | 'user-list' | 'user-detail' | 'catalog-list' | 'catalog-detail' | 'item-detail'`，保留 `MemoryCommandSurfaceMode = 'list' | 'edit' | 'deleteConfirm'`
- [x] 1.2 在 `src/types/command/management-surface.ts` 新增 `MemoryCommandRow`（`id`、`kind`、`label`、`value?`、`detail?`、`dot?`、`tone?`），`kind` 取 `'entry' | 'action' | 'toggle' | 'field' | 'option'`，每个字段补中文 `//` 注释
- [x] 1.3 `MemoryCommandSurface` 用 `rows` + `selectedIndex` 取代 `memories` / `catalogs` / `agentItems` / `selectedCatalog`，新增 `detailContent?: string`，保留 `itemCounts`、`scope`、`catalogForm`、`editText`、`editCursor`、`error`、`dismissHint`
- [x] 1.4 在 `src/types/command/index.ts` 导出 `MemoryCommandRow`
- [x] 1.5 handler 私有 `MemoryData` 增加 `focusId`、`detailEntryId`、`deleteTarget`、`deleteIndex`、`deleteReturnSection`、`editReturnSection`，并把 `selectedIndex` 语义改为当前 `section` 的 rows 索引
- [x] 1.6 实现 `rowsForTypes`、`rowsForUserList`、`rowsForCatalogList`，验证条目行下标与数据数组下标一致、新增动作行固定在末尾

## 2. user memory 分层改造

- [x] 2.1 `user-list` 的 SUBMIT 改为按行 id 分派：`entry:` 打开 `user-detail` 并记录 `focusId`，`action:add-user` 进入新建编辑
- [x] 2.2 实现 `rowsForUserDetail`：内容摘要字段、启停 toggle 行、`action:edit-user`、`action:delete-user`
- [x] 2.3 删除动作改为进入三行确认层（目标摘要 readonly 行 + `option:cancel` + `option:delete`），默认焦点落在取消
- [x] 2.4 `confirmDelete` 改用 `deleteTarget` 定位对象，删除 `getSelected` 反推路径，并断言删除的是进入详情的那一条
- [x] 2.5 实现 Esc 链：`user-detail` → `user-list`（按 `focusId` 恢复）、`user-list` → `types`、`edit` / `deleteConfirm` 回到进入前层级
- [x] 2.6 删除 `handleList` 中的 `'a'`、`'e'`、`'d'` 分支，确认 `a` 与 `e` 在 `/memory` 中不再被消费
- [x] 2.7 重写 `createDismissHint`，按 `section` 与 `mode` 输出只含 Up/Down/Enter/Space/Esc 的文案

## 3. agent catalog 与 item 分层改造

- [x] 3.1 `catalog-list` 行投影保留 dot + `名称 — 描述`，末尾追加 `action:add-catalog`
- [x] 3.2 实现 `rowsForCatalogDetail`：`field:name`、`field:description`、`action:toggle-catalog`、item 条目行、`action:add-item`、`action:edit-catalog`、`action:delete-catalog`
- [x] 3.3 实现 `rowsForItemDetail`：完整内容、`action:toggle-item`、`action:edit-item`、`action:delete-item`
- [x] 3.4 接通 `catalog-list` → `catalog-detail` → `item-detail` 的 Enter 分派与逐级 Esc 返回，包含 `focusId` 恢复
- [x] 3.5 保存成功后按 `editReturnSection` 回到进入编辑前的层级，并让焦点落在新建或编辑的那一条
- [x] 3.6 保留 catalog 新建/编辑的三字段表单与 `refreshCatalogs` 的选中恢复（`selectedId`）行为
- [x] 3.7 确认空 catalog 列表与空 item 列表仍渲染新增动作行，删除渲染层所有“按 a 新增”文案

## 4. 渲染层

- [x] 4.1 `renderMemorySurface` 改为按 `row.kind` 统一渲染：`entry` 用双列行、`action` / `option` 用 `actionRow`、`toggle` 用 `renderDot` + 双列、`field` 用 `kvRow`
- [x] 4.2 改用 `src/render/footer/config-panel-rows.ts` 的共享原语，删除本地 `renderToggle`、`renderPlainOptions`、`selectedLine`、`topLine`、`bottomLine`、`line`
- [x] 4.3 详情层用 `wrapText` 按 `contentWidth` 折行，超过行数上限时保留前 N 行并追加“还有 M 行”提示，保证动作行始终可见
- [x] 4.4 删除确认层渲染目标摘要与两行选项，`tone: 'danger'` 走危险色
- [x] 4.5 保留编辑态的真实光标投影（`projectEditText`、`projectInlineField`、`createCursorLineWindow`）与 catalog 表单渲染逻辑不变
- [x] 4.6 把 `MEMORY_MAX_VISIBLE` 对齐 `/mcp` 的 8，并确认每行渲染宽度不超过 `safeRenderWidth`

## 5. 测试

- [x] 5.1 更新 `test/commands/memory-command-handler.test.js` 现有用例的按键路径：字母键改为移动到动作行后 `SUBMIT`
- [x] 5.2 新增“空列表通过新增动作行进入新建”的用例，覆盖 user memory、catalog、item 三层
- [x] 5.3 新增“详情层展示完整内容并提供三个动作行”的用例
- [x] 5.4 新增“从详情层删除”的用例，断言删除目标来自详情条目而不是列表首项
- [x] 5.5 新增“详情 Esc 返回父列表落在同一行”的用例
- [x] 5.6 新增“删除确认默认焦点为取消、Esc 不删除”的用例
- [x] 5.7 渲染用例改为通过 handler 产出 surface，断言行宽不溢出、不再出现字母键提示、详情正文被限高
- [x] 5.8 顺序执行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`

## 6. 文档与手动验证

- [x] 6.1 更新 `docs/tui-architecture.md` 的 `memory` surface 行：改为行投影 + 详情/编辑/确认分层描述，去掉“编辑态显示光标”以外的旧键位表述
- [ ] 6.2 按 `AGENTS.md` 的交互清单手动验证：`/memory` 三层进出、空列表新增、启停 Space 与 Enter、详情编辑往返、删除默认取消、Esc 逐级返回、窄终端与 resize 重绘
- [x] 6.3 运行 `openspec validate align-memory-command-surface --strict` 确认产物结构仍然有效
