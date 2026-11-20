## 1. 配置 schema 与归一化

- [x] 1.1 在 `src/config/app-settings-config.ts` 新增 `StatusLineSegments` 类型，包含 `approval`、`contextUsage`、`dir`、`effort`、`model`、`title` 六个布尔字段，每个字段补中文行内注释说明该 segment 对应的可见内容。
- [x] 1.2 新增 `DEFAULT_STATUS_LINE_SEGMENTS`（全部 `true`），新增 `StatusLineSegment` 键类型与 `STATUS_LINE_SEGMENT_KEYS` 有序列表，供渲染层和配置面板共用同一份行顺序。
- [x] 1.3 在 `AppSettings` 增加 `statusLineSegments: StatusLineSegments`，并在 `DEFAULT_APP_SETTINGS` 中填入默认值。
- [x] 1.4 在 `normalizeAppSettings()` 中读取 `ui.statusLine`，对每个字段独立判定 `typeof === 'boolean'`，非法或缺失时回退默认 `true`；节点不是对象时整体回退默认值。
- [x] 1.5 在 `applyAppSettingsDraft()` 中以浅合并方式写入 `ui.statusLine` 的六个字段，保留该节点下的未知字段与 `ui` 下的其他兄弟键。
- [x] 1.6 在 `validateAppSettingsDraft()` 中校验六个字段均为布尔值，失败时返回可理解中文错误；确认该校验不会被其他字段的失败短路误报。
- [x] 1.7 把 `statusLineSegments` 加入 `AppRenderPreferences` 的 `Pick`，并同步 `DEFAULT_RENDER_PREFERENCES`。

## 2. 状态派生与即时刷新

- [x] 2.1 在 `AppContext.createRenderState()` 的 `renderPreferences` 组装中补上 `statusLineSegments`，来源为当前缓存的 `AppSettings` snapshot。
- [x] 2.2 在 `AppContext.applyAppSettingsSnapshot()` 增加 `statusLineSegmentsChanged` 标志，按六个字段的逐项比较而非整对象引用比较，避免同值通知误判变化。
- [x] 2.3 在 `src/app/main.ts` 的配置订阅回调中把 `statusLineSegmentsChanged` 并入"只需 `renderCoordinator.render()`"分支，明确排除 destructive replay 路径。
- [x] 2.4 核对 `applyAppSettingsSnapshot()` 的返回类型与调用方解构，保证新增字段不会与 `historyRenderLineLimitChanged`、`reasoningVisibilityChanged` 的分支顺序冲突。

## 3. 渲染层 segment 过滤

- [x] 3.1 在 `src/render/footer.ts` 把 `renderComposerSurface()` 的 `slashSuggestionMaxVisible` 位置参数替换为整个 `renderPreferences`，并同步 `renderSubagentViewSurface()` 的调用。
- [x] 3.2 在 `src/render/footer/composer-surface.ts` 调整 `renderComposerSurface()` 与 `renderSubagentViewSurface()` 签名，把偏好下传到 `renderStatusLineText()`。
- [x] 3.3 修改 `createLeftStatusSegments()`：按 `segments.model`、`segments.effort`、`segments.title`、`segments.approval`、`segments.dir` 决定是否 push，保持原有相对顺序与着色。
- [x] 3.4 修改 `createRightStatusSegments()`：按 `segments.contextUsage` 决定是否 push `ctx` segment；tuning 保存错误、mode segment 与 key hint 保持无条件保留。
- [x] 3.5 在 `createModelTuningStatusSegments()` 与默认模型 segment 的选择处加入强制显示：`model.kind === 'tuning'` 时忽略 `model` / `effort` 开关。
- [x] 3.6 确认 `joinStatusSegments()` 对空数组返回空串、`renderStatusLineText()` 在左侧为空时仍能正确右对齐，且全关时输出非空的 mode 行。
- [x] 3.7 为新增与修改的函数补 JSDoc 风格中文方法注释，说明过滤依据、强制显示不变量和降级顺序。

## 4. 配置中心入口行与子面板

- [x] 4.1 在 `src/types/command/config-surface.ts` 的 `ConfigCommandSurface` 联合中追加 `{kind: 'config'; view: 'statusLine'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: StatusLineConfigState}`，并为新字段补中文行内注释。
- [x] 4.2 新增 `StatusLineConfigState` 类型（`selectedIndex`、可选 `error` / `feedback`），文件位置与 `SystemPromptConfigState` 保持一致；在 `src/types/command/index.ts` 聚合导出，保持 `index.ts` 只做聚合。
- [x] 4.3 在 `src/commands/config/state.ts` 的 `GENERAL_CONFIG_BASE_ROW_IDS` 中、`reasoningSummary` 之后插入 `'statusLine'`，并把 `'statusLine'` 加入 `GeneralConfigRowId`。
- [x] 4.4 在 `state.ts` 新增 `getStatusLineConfigRowIds()`（六个开关 + `save`）与 `createInitialStatusLineConfigState()`；开关行顺序复用 `STATUS_LINE_SEGMENT_KEYS`。
- [x] 4.5 在 `createConfigSurface()` 中按 `data.statusLine` 优先返回 `view: 'statusLine'`，并把当前草稿的 `statusLineSegments` 一并投影进 state 快照。
- [x] 4.6 在 `src/commands/config/handler.ts` 的 `ConfigCommandData` 增加 `statusLine?: ConfigStateSlot<StatusLineConfigState>`，并在 `handleEvent` 中优先分发到 `handleStatusLineEvent`。
- [x] 4.7 实现子面板事件：Up/Down 移动焦点、Home/End 跳到首尾、Enter/Left/Right 切换开关行、`save` 行调用 `host.config.saveSettings` 并复用成功/失败反馈。
- [x] 4.8 实现 Esc/Backspace 返回常规 Tab 并清空 `data.statusLine`，保留常规草稿；实现 Tab 退出子面板并切到下一个 Tab。
- [x] 4.9 在常规 Tab 的 `SUBMIT` 分支中处理 `'statusLine'` 行：进入子面板并把焦点置 0，不写入任何 segment。
- [x] 4.10 确认 `createConfigTabs()` 的 dirty 计算继续由 `general` 承担，子面板不产生额外 Tab 状态；子面板的错误与反馈不污染常规 Tab 的 fingerprint。

## 5. 配置面板渲染

- [x] 5.1 在 `src/render/footer/config-surface.ts` 的 `renderGeneralView()` 中补充 `'statusLine'` 行的三态摘要文案（`6 项全开` / `N 项开启` / `全部隐藏`），并为其提供与 `reasoningSummary` 风格一致的提示说明。
- [x] 5.2 新增 `renderStatusLineView()`：复用 `config-panel-rows.ts` 的 `top`、`renderTabsLine`、`splitRow`、`actionRow`、`bottom`、`dimHint` 原语，渲染六个开关行、保存行与底部按键提示。
- [x] 5.3 在 `renderConfigSurface()` 中增加 `view === 'statusLine'` 分支并把结果交给 `constrainLayoutTail`。
- [x] 5.4 处理窄高度降级：优先保留包含当前焦点的行窗口，其次保留外框与 Tab strip，复用 `createSelectedWindowRows` 与 `normalizeLineLimit`。

## 6. 测试

- [x] 6.1 扩展 `test/config/app-settings-config.test.js`：`ui.statusLine` 缺失时全部默认 `true`；单字段非法只回退该字段；`ui.statusLine` 非对象时整体回退；保存只写六个字段并保留未知兄弟键；非布尔草稿被校验拒绝且不写文件。
- [x] 6.2 扩展 `test/render/footer.test.js`：默认偏好下 status line 输出与既有断言等价；逐项关闭后对应文本消失且其他 segment 仍在；六个全关时行内只剩 mode；关闭后不出现连续或悬空分隔符；tuning 态下关闭 model/effort 仍显示 `‹value›`。
- [x] 6.3 在 `test/render/footer.test.js` 中补齐两处仅含部分字段的 `renderPreferences` 测试数据，使其符合运行时类型。
- [x] 6.4 扩展 `test/render/config-surface.test.js`：常规页 `'statusLine'` 行三态摘要；子面板渲染七个可操作行；窄高度下焦点行不被裁掉。
- [x] 6.5 扩展 `test/commands/config-command-handler.test.js`：Enter 进入子面板；切换开关只改草稿不改文件；保存行写入 `ui.statusLine`；Esc 返回常规 Tab 不关闭配置中心；Tab 切到下一个 Tab；未保存时关闭配置中心触发放弃确认。
- [x] 6.6 新增或用例补充 subagent 视图路径：`renderSubagentViewSurface` 在关闭 `contextUsage` 后不显示 `ctx` segment。

## 7. 文档与验证

- [x] 7.1 在 `docs/configuration.md` 新增"状态栏显示项"小节：说明 6 个字段、默认值、`ui.statusLine` JSON 示例、非法值回退、只影响 status line 不影响命令 surface 与 headless。
- [x] 7.2 在 `docs/tui-architecture.md` 的 status line 相关表格与说明中补充可选 segment 可配置、mode/key hint 固定、tuning 强制显示三点。
- [x] 7.3 依次运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [ ] 7.4 手工验证：`npm start` 后打开 `/config` → 常规 → 状态栏显示项，逐项开关并保存，确认 status line 即时变化、dirty 标记正确、Esc/Tab 层级正确、`Ctrl+T` 调节期间 model/effort 仍可见、全关后 mode 仍显示、`Ctrl+C`/`Ctrl+D` 正常退出。
