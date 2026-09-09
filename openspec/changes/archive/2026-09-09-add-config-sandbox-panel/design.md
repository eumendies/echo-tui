## Context

`/config` 已是三件套架构：`src/commands/config/state.ts`（`CONFIG_TABS`、每 Tab 草稿槽位、fingerprint 脏跟踪、动态行投影）、`handler.ts`（输入事件状态机、`initializeTab` 懒初始化、Esc 统一放弃确认）、`src/render/footer/config-surface.ts`（视图渲染）。现有 Tab：常规、模型与 Provider、外观。

沙箱能力由 add-macos-bash-sandbox 落地：`tools.sandbox` 的解析校验在 `src/config/llm-config.ts`（`SANDBOX_MODES`、`readSandboxToolConfig`，均为私有）；`UserConfigContext` 已具备 `tools` 域 fingerprint 与 `updateRoot` 原子写回，保存即发布新 revision；沙箱 provider 在每次 bash 命令执行时从 config snapshot 解析，因此写入后天然即时生效。`/status` 已展示沙箱档位、网络与可用性。

## Goals / Non-Goals

**Goals:**

- 在 `/config` 内完整编辑 `tools.sandbox`（档位、网络、`extraWritablePaths`），交互与常规 Tab 一致
- 保存后下一条 bash 命令即时按新边界执行，无需重启
- 校验就地报错、非法草稿不落盘；脏草稿接入现有统一放弃确认
- 完全复用现有 Tab / 端口 / 写回机制，不引入新 surface 类型

**Non-Goals:**

- 不改变沙箱 runtime 语义（`bash-sandbox` spec 不动，不改 provider 与 profile 生成）
- 不做目录存在性校验与路径选择器（Seatbelt `subpath` 前缀匹配允许目录稍后创建）
- 不提供 SBPL profile 预览
- 不在 read-only 档禁用目录编辑（保存照存、runtime 忽略，见 Decisions 5）

## Decisions

1. **草稿读写层独立为 `src/config/sandbox-config-editor.ts`**：`createSandboxConfigDraft` / `applySandboxConfigDraft`，分层与 `app-settings-config.ts` 的 normalize/validate/apply 对齐；从 `llm-config.ts` 导出 `SANDBOX_MODES` 复用，校验文案与解析层一致。备选是直接复用 `readSandboxToolConfig`，但它按数组下标报错且面向整根解析，草稿层需要逐字段校验语义，硬套会污染解析层的错误契约。
2. **`host.config` 端口新增 `readSandboxDraft` / `saveSandboxDraft`**，而非并入 AppSettings：沙箱属 `tools` 域，独立方法让 `saveSandboxConfigDraft` 走 `updateRoot` 后 `tools` 域 fingerprint 精确变化、订阅者按域感知。备选（并入 `saveAppSettingsDraft`）会把 `tools` 域变化伪装成 `appSettings` 域。
3. **行内输入复用 TEXT / BACKSPACE 事件 + `pathInput` 缓冲**（与 models tab 的 editBuffer 模式同构但更简单）：不新增 surface 模式；Esc 取消、Enter 校验确认。
4. **动态行投影 `getSandboxConfigRowIds` 由 handler 与 renderer 共享**（照 `getGeneralConfigRowIds` 模式），保证选中窗口与焦点不错位。
5. **read-only 档不特殊处理 `extraWritablePaths`**：UI 可编辑、保存照存、runtime 忽略（provider 既有归一化语义）；好处是档位往返切换不丢草稿。备选（read-only 时禁用路径行）会新增状态分支且切档丢草稿。
6. **Tab 顺序：常规 → 模型与 Provider → 沙箱 → 外观**（外观保持最后）；`config-surface-settings` 的「Tab 配置中心」requirement 以 MODIFIED 全文迁移更新为四 Tab 语义。

## Risks / Trade-offs

- [Tab 循环次数变化影响现有断言与文档] → 同步更新 `config-command-handler` / `config-surface` 测试与 `docs/tui-architecture.md`；MODIFIED requirement 整块迁移防止归档时丢失场景
- [保存即时换档，下一条命令可能被新边界拒绝] → 面板保存反馈明示已保存；`/status` 沙箱行可核对当前生效档位
- [行内输入无路径补全，输错目录要等保存校验兜底] → 绝对路径 / 非空 / 不重复三重校验；存在性刻意不校验（subpath 语义允许稍后创建）
- [目录条数多时面板超高] → 沿用 `createSelectedWindowRows` 窗口滚动

## Migration Plan

无数据迁移：配置格式不变，已手写 `tools.sandbox` 的用户打开面板即读到现值。回滚直接 revert（改动集中在独立文件与既有文件的局部扩展）。

## Open Questions

无。
