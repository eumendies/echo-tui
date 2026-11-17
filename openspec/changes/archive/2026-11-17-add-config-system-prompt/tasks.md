## 1. 类型与 surface 协议

- [x] 1.1 新增 `src/types/command/system-prompt-surface.ts`：定义 `SystemPromptTarget`（project / global）、`SystemPromptSurfaceMode`（menu / read / edit / confirmSave / confirmReset）、`SystemPromptMenuRow`（id / available）、`SystemPromptFileFact`（filePath / exists / lines / content / unavailableReason）、`SystemPromptDynamicSection`（label / detail / estimatedTokens）、`SystemPromptConfigState`（mode / target / confirmIndex / selectedIndex / readScroll / sourceKind / project / global / menuRows / baseContent / dynamicSections / pendingFallback / pendingOverwrites / draft / error / feedback）；每个 type 与字段补中文行内注释说明不变量。
- [x] 1.2 在 `src/types/command/config-surface.ts` 的 `ConfigCommandSurface` 联合中追加 `{kind: 'config'; view: 'systemPrompt'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: SystemPromptConfigState}`。
- [x] 1.3 在 `src/types/command/index.ts` 导出新增类型，保持 `index.ts` 只做聚合、不声明类型。
- [x] 1.4 在 `src/types/command/host.ts` 的 `config` 端口追加 `readSystemPrompt()`、`saveSystemPrompt(target, content)`、`deleteSystemPrompt(target)` 三个方法及其返回结果类型。

## 2. 文件快照与原子写入（agent 层）

- [x] 2.1 在 `src/agent/context/system-prompt.ts` 新增 `resolveSystemPromptSnapshot(options)`：返回 project / global 两个目标的绝对路径、存在性、行数、可选内容与读取失败原因，以及当前生效来源与基础文本；复用 `SYSTEM_FILE_NAME`、`getDefaultGlobalSystemPromptPath`、`findProjectRoot`，沿用文件存在性与空内容判定口径。
- [x] 2.2 新增 `writeSystemPromptOverride({target, content, cwd, homedir, fs})`：内容归一化（CRLF/CR → LF、去首尾空白）、归一化后为空则返回拒绝结果、父目录 `mkdir -p`、同目录临时文件 + rename 原子替换，失败时尽力清理临时文件；返回是否覆盖。
- [x] 2.3 新增 `deleteSystemPromptOverride({target, cwd, homedir})`：只删除目标 `SYSTEM.md`，`ENOENT` 归类为已完成而非错误。
- [x] 2.4 三个函数接受可注入的 fs 依赖（readFile / stat / writeFile / mkdir / rename / unlink），默认使用 `node:fs`，供 node:test 覆盖分支。
- [x] 2.5 核对 `loadSystemPromptOverride()` 行为与新增函数共用同一归一化实现，避免出现第二份 trim/CRLF 处理。

## 3. 端口装配（app 层）

- [x] 3.1 新增 `src/app/command/system-prompt-command-port.ts`：实现 `readSystemPrompt()`，在快照基础上组装动态段摘要（Runtime environment、AGENTS.md、Skills、Memory），skills 与 memory 复用 `createSkillManager` / `createSkillCatalogPromptProjection` / `resolveMemoryPrompt` / `estimateTextTokens`。
- [x] 3.2 动态段组装按段隔离失败：单段解析异常只降级该段展示，不影响其它段与快照主体。
- [x] 3.3 实现 `saveSystemPrompt()` / `deleteSystemPrompt()`：调用 agent 层函数，成功写入或确实删除文件后调用 `appContext.clearContextUsage()` 并返回结构化结果（含是否覆盖、回落来源）。
- [x] 3.4 在 `src/app/command/command-host.ts` 把新端口合并进 `config` 端口。
- [x] 3.5 为新增函数补 JSDoc 风格中文方法注释，说明参数、返回与失败语义。

## 4. 配置中心状态与 handler

- [x] 4.1 在 `src/commands/config/state.ts` 的 `GENERAL_CONFIG_BASE_ROW_IDS` 中、`instructionFile` 之后插入 `'systemPrompt'`。
- [x] 4.2 新增 `getSystemPromptMenuRowIds(state)`，返回固定顺序的六行 `['view', 'editProject', 'editGlobal', 'deleteProject', 'deleteGlobal', 'back']`；`deleteProject` / `deleteGlobal` 在对应文件不存在时标记为不可用。
- [x] 4.3 新增 `createInitialSystemPromptConfigState(snapshot)`，初始为 menu 态、焦点在第一行。
- [x] 4.4 在 `createConfigSurface()` 中按 `data.systemPrompt?.state` 优先返回 `view: 'systemPrompt'`；`createConfigTabs()` 与 dirty 计算保持不含该视图。
- [x] 4.5 在 `src/commands/config/handler.ts` 的 `ConfigCommandData` 增加 `systemPrompt?: ConfigStateSlot<SystemPromptConfigState>`，并在 `handleEvent` 中优先分发到 `handleSystemPromptEvent`。
- [x] 4.6 实现 menu 事件：Up/Down 移动焦点、Enter 按行 id 进入 read / edit / confirmReset / 返回常规 Tab，删除行不可用时只设 error 提示。
- [x] 4.7 实现 read 态：Up/Down 逐行、PageUp/PageDown 翻页（按可用窗口高度）、Esc 回 menu 并重置滚动偏移。
- [x] 4.8 实现 edit 态：用 composer 承载草稿，`SUBMIT` 进入 `confirmSave`，`INSERT_NEWLINE` 插入换行，Esc 丢弃草稿回 menu；预填当前目标内容，缺失时预填内置默认。
- [x] 4.9 实现 `confirmSave`：Up/Down 二选一、Enter 调用端口写入（未变化时短路并提示）、Esc 回 edit；成功后刷新快照、回 menu、写入“下一轮 assistant run 生效”反馈。
- [x] 4.10 实现 `confirmReset`：Up/Down 二选一、Enter 调用端口删除、Esc 回 menu；成功后刷新快照并提示回落来源。
- [x] 4.11 常规 Tab `SUBMIT` 命中 `systemPrompt` 行时读取快照并进入视图；读取失败时在常规 Tab 内显示错误而不是进入空视图。
- [x] 4.12 处理 Tab 与 Esc 层级：menu/read 下 Tab 退出视图并切下一 Tab，edit/confirm 下忽略；`requestClose` 在子视图内先清空 `data.systemPrompt` 退回常规 Tab。
- [x] 4.13 子视图不进入 `discardConfirm` 的 dirty 列表，确认未保存草稿在任意退出路径都被丢弃且不写盘。

## 5. 渲染

- [x] 5.1 新增 `src/render/footer/system-prompt-surface.ts`：实现 menu / read / edit / confirmSave / confirmReset 五个投影，复用 `config-panel-rows.ts` 的边框、双列与动作行原语以及 `window.ts` 的窗口裁剪。
- [x] 5.2 menu 态渲染状态区（当前生效、项目文件、全局文件）、六个按钮与动态段摘要；超过 64 KiB 的目标以警告样式标注体积。
- [x] 5.3 read 态渲染带行号的正文与滚动窗口，标题包含来源；`PgUp/PgDn` 按视口高度翻页。
- [x] 5.4 edit 态渲染多行 composer 并返回正确的 `cursorRow` / `cursorColumn` / `showCursor`。
- [x] 5.5 确认态渲染目标绝对路径与覆盖事实；删除确认额外渲染回落目标。
- [x] 5.6 footer 高度不足时优先保留状态区与当前焦点按钮，动态段摘要可整段省略。
- [x] 5.7 在 `src/render/footer/config-surface.ts` 增加 `systemPrompt` 分支转发，并在 `renderGeneralView` 中补充“系统提示词”行的三态取值文案。

## 6. 测试

- [x] 6.1 扩展 `test/agent/system-prompt.test.js`：快照解析（两目标并存、单目标不可读、空文件视为不存在、无 git/.echo 标记退化为 cwd）、写入归一化与原子替换、mkdir 分支、内容未变化、空内容拒绝、删除幂等与 ENOENT。
- [x] 6.2 新增 `test/commands/system-prompt-command-handler.test.js`：常规行进入视图、六行焦点移动、删除行不可用提示、menu↔read、PgUp/PgDn 滚动、edit 预填与取消、confirmSave 写入与未变化短路、confirmReset 删除、Tab 与 Esc 层级、成功反馈与 context usage 失效。
- [x] 6.3 新增 `test/render/system-prompt-surface.test.js`：五态渲染、极窄与极小高度下的焦点保留、动态段降级文案、行号宽度自适应、编辑态光标定位。
- [x] 6.4 同步 `test/render/config-surface.test.js` 中常规 Tab 行标签与行集合相关断言。
- [x] 6.5 确认既有 `test/commands/slash-command.test.js` 与历史重绘预算 fixture 在新增常规行后仍通过，必要时只调整按行 id 定位的部分。

## 7. 文档与规格

- [x] 7.1 `README.md` 的“项目指令与扩展”章节补充：`/config` → 常规 → 系统提示词，可查看来源、编辑项目或全局 `SYSTEM.md`、删除覆盖恢复默认。
- [x] 7.2 `docs/configuration.md` 补充两目标路径、优先级、归一化与原子写入语义、生效时机（下一轮 run）、空文件等价于不存在。
- [x] 7.3 `docs/tui-architecture.md` 更新命令模块表、footer surface 列表与 `src/agent/context/system-prompt.ts` 职责说明。
- [x] 7.4 归档时把 `openspec/changes/add-config-system-prompt/specs/config-system-prompt/spec.md` 落到 `openspec/specs/config-system-prompt/spec.md`，并确认 `streaming-llm-service-adapter` 无需改动。

## 8. 校验与手动验证

- [x] 8.1 `npm run typecheck`。
- [x] 8.2 `npm test`。
- [x] 8.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
- [x] 8.4 `npm start` 后手动走查：常规 Tab 摘要三态、进入视图、查看生效内容与滚动、编辑项目文件并确认写入、编辑全局文件新建 `~/.echo`、内容未变化提示、空内容拒绝、删除后回落提示、Tab 与 Esc 层级、`/context` 缓存已失效。
- [x] 8.5 手动验证既有语义未回归：写入项目 `SYSTEM.md` 后同一 run 内 tool continuation 仍使用旧基础文本，下一轮才切换；`echo-tui --once "..."` 使用新文件。
- [x] 8.6 `openspec validate add-config-system-prompt --strict`。

## 9. 复审修正

- [x] 9.1 阅读态与编辑态改为按终端宽度折行：阅读态用 `wrapText` 展开物理行（续行不重复行号），编辑态改用 `renderComposer` 获得折行后的可见行与真实光标行列，删除行尾 `clampPlainText` 截断。
- [x] 9.2 抽出 `projectSystemPromptRead` 纯投影并导出，handler 用 `host.status.getViewport()` 取同一次投影的滚动上限，替换原先按逻辑行数的夹取。
- [x] 9.3 移除全部体积展示：常规行、状态区、删除行、阅读态标题都不再显示字节数；删除 64 KiB 警告与 `formatSystemPromptBytes`；保存确认只保留路径与覆盖事实。

## 10. 第二轮 review 收敛

- [x] 10.1 合并三份来源映射为 `describeSystemPromptSourceKind(kind | 'unknown')`，`describeTarget` 直接复用；内联 `createSystemPromptSummary`，`createInitial`/`apply` 合并为 `withSystemPromptSnapshot`。
- [x] 10.2 快照移除恒定的 `builtinContent`；编辑新建改为直接使用 `BUILT_IN_SYSTEM_PROMPT`。
- [x] 10.3 动态段摘要改为按需计算：`readSystemPrompt({includeDynamicSections})`，仅进入视图时扫描 skills / instructions / memory；RUNTIME environment 文案与真实 builder 共用 `formatRuntimeEnvironmentPrompt`。
- [x] 10.4 菜单行与删除回落文案进入 surface 快照（`menuRows` / `pendingFallback`），renderer 不再反向依赖 `commands/config/state`。
- [x] 10.5 极小高度降级改为按优先级保留：`< 3` 只留焦点按钮，其余用 `createSelectedWindowRows` 保留状态行与焦点，不再把 4–10 行预算压成 3 行。
- [x] 10.6 阅读态翻页改用 `projectSystemPromptRead` 的视口高度，删除固定 `PAGE_STEP=10`。
- [x] 10.7 写入失败按步骤报告（创建目录 / 写入临时文件 / 替换目标文件）并尽力清理临时文件；`deleteSystemPromptOverride` 返回 `removed`，仅真实删除时失效 context usage。
- [x] 10.8 收窄 agent 层注入面为单个 `fs` 对象，删除测试专用导出（`normalizeSystemPromptContent`、`resolveSystemPromptTargetPath`）；新增 `wrapTextToWidth` 精确折行入口，阅读态不再用 `+1` 补偿。
- [x] 10.9 config 命名空间改由 `createConfigCommandPorts` 单独装配，取消 `Omit` + 双 spread；`model-command-ports` 只保留 model 域。
- [x] 10.10 移除 system prompt 路径上多余的 `as` 断言与不可达的 `target` 判空；`target` 改为必填，编辑态草稿缺失时直接忽略事件而不是伪造空草稿。
- [x] 10.11 同步过期文档：tasks 1.1/2.1/2.2/3.3/5.3/5.5 去掉字节与旧字段名；spec 明确 ENOENT 不触发 context usage 失效。
- [x] 10.12 合并 `loadSystemPromptOverride` 与事实快照的重复读取：loader 改为复用 `readSystemPromptTarget` 与 `resolveSystemPromptTargetPath`，删除独立的 `readSystemPromptFile`，读取策略只保留一份实现。
