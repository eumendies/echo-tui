## 1. 配置草稿读写层

- [x] 1.1 `src/config/llm-config.ts` 导出 `SANDBOX_MODES` 供草稿层复用
- [x] 1.2 新建 `src/config/sandbox-config-editor.ts`：`createSandboxConfigDraft`（读取缺省 workspace-write + 网络开启 + 空数组）与 `applySandboxConfigDraft`（档位/网络/路径逐字段校验，写回 `root.tools.sandbox` 且保留 tools 其他字段，校验失败抛出与解析层对齐的错误）
- [x] 1.3 新增 `test/config/sandbox-config-editor.test.js`：缺省值、读取现值、合法写回（tools 其他字段保留）、非法档位/非布尔网络/空或相对或重复路径报错

## 2. 配置上下文与 host 端口

- [x] 2.1 `src/config/user-config-context.ts`：snapshot 增加 `getSandboxConfigDraft`（缓存 + 克隆，valid/missing 可读）；context 增加 `saveSandboxConfigDraft`（走 `updateRoot`）
- [x] 2.2 `src/app/command/model-command-ports.ts`：`config` 端口实现 `readSandboxDraft` / `saveSandboxDraft`（委托 userConfigContext，失败返回 `{ok:false, error}`）
- [x] 2.3 `test/config/user-config-context.test.js` 追加：缺省草稿读取、保存后 revision 与 `tools` 域变化且再读一致、missing 文件保存时创建

## 3. 类型与 Tab 状态机

- [x] 3.1 `src/types/command.ts`：新增 `SandboxConfigDraft` / `SandboxConfigState`；`ConfigTabId` 加 `'sandbox'`；`ConfigCommandData` / `ConfigCommandSurface` 加沙箱分支；`host.config` 端口声明 `readSandboxDraft` / `saveSandboxDraft`
- [x] 3.2 `src/commands/config/state.ts`：`CONFIG_TABS` 加「沙箱」（模型与 Provider 之后、外观之前）；`createInitialSandboxConfigState` / 动态行投影 `getSandboxConfigRowIds` / 脏跟踪 / `markSandboxConfigSaved`；`createConfigSurface` / `createConfigTabs` / `getActiveSlot` 扩展沙箱分支
- [x] 3.3 `src/commands/config/handler.ts`：`initializeTab` 沙箱懒初始化；`handleSandboxEvent`（档位三档循环、网络切换、目录 Enter 移除、`+ 添加可写目录` 行内输入 TEXT/BACKSPACE/Esc、保存走 `host.config.saveSandboxDraft`）；`requestClose` 脏列表加「沙箱」

## 4. 渲染

- [x] 4.1 `src/render/footer/config-surface.ts` 新增 `renderSandboxView`：档位/网络/目录行（Enter 移除提示）、添加入口、行内输入光标行、error/feedback 行、`createSelectedWindowRows` 窗口滚动与按键提示

## 5. 测试、文档与验证

- [x] 5.1 `test/commands/config-command-handler.test.js` 追加：四 Tab 循环、沙箱事件流（档位循环/网络切换/路径增删/非法路径报错/保存成功与失败/Esc 放弃确认/输入模式取消）、切 Tab 保留现场
- [x] 5.2 `test/render/config-surface.test.js` 追加：沙箱视图渲染（四 Tab 条、行内容与选中态、行内输入光标、error/feedback）
- [x] 5.3 校验命令：`npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.4 `docs/tui-architecture.md` 沙箱节补充 `/config` 沙箱 Tab 入口与保存即时生效说明
- [x] 5.5 手动验证（TUI）：`/config` 切到沙箱 Tab 三档循环与网络切换；添加/移除目录并保存后核对 `~/.echo/config.json`；保存改 `read-only` 后下一条 bash 命令即时生效且 `/status` 沙箱行更新；脏草稿 Esc 触发放弃确认；`read-only` 档下目录列表可编辑、runtime 忽略
