## Context

echo-tui 的 `/status` 已支持两类 provider 专属远端查询:Codex OAuth 限额用量(`src/config/codex-oauth.ts` 的 `queryCodexUsage`,5 小时 + 每周百分比窗口)与 DeepSeek 官方余额(`src/config/deepseek-balance.ts` 的 `queryDeepseekBalance`,账户余额)。两者共享同一管线:status 命令端口(`src/app/command/status-command-ports.ts`)按活动 provider 门控 → 并行查询 → `status-surface.ts` 渲染,失败降级为「不可用」且不写 transcript。

OpenCode Go 预设(`opencode-go`、`opencode-go-responses`、`opencode-go-anthropic`)共用 `https://opencode.ai/zen/go/v1`,按美元计费配额(5 小时 = 月额度 20%、每周 = 50%、每月 = 100%)。上游已部署 `GET /zen/go/v1/usage`:Bearer API key 鉴权(与 chat completions 相同)。真实响应(真实 key 联调确认)为键控对象:`{"usage": {"rolling" | "weekly" | "monthly": {"status": string, "percent": number, "resetsAt": ISO 时间字符串}}}`,不含订阅档位、useBalance 或美元金额。

## Goals / Non-Goals

**Goals:**

- `/status` 中展示 OpenCode Go 订阅的三个配额窗口(百分比、reset 时间)
- 与 Codex/DeepSeek 完全一致的门控、降级、脱敏与加载语义
- 一个门控函数覆盖全部三个 opencode-go 预设

**Non-Goals:**

- 不做自动轮询、footer 常驻展示或本地缓存(仅 `/status` 触发时查询,与现状一致)
- 不做 console 抓取或 cookie 会话依赖(上游明确排除)
- 不处理 Zen 余额(区别于 Go 订阅配额)的查询

## Decisions

1. **独立模块 `src/config/opencode-usage.ts`,不并入既有两个查询模块。** 一个模块对应一个外部服务,错误类型、URL 常量与解析互不耦合;依赖注入 `fetch`/`usageUrl` 供测试,模式照 `deepseek-balance.ts`。

2. **门控用 baseURL 而非 preset id。** 活动 LLM config 不携带 preset id,`baseURL` 是唯一可靠信号;判定条件为 hostname === `opencode.ai` 且 pathname 以 `/zen/go/` 开头——三个 opencode-go 预设共用同一 baseURL,一个判定全覆盖。备选「按 preset id 白名单」需要把 preset id 透传进 config,复杂度不划算。

3. **响应严格校验 + 宽容展示。** 校验 `usage` 必须为对象;窗口逐项校验(`status` 为非空字符串、`percent` 为有限数字、`resetsAt` 为可解析的 ISO 时间),残缺响应整块判失败;窗口键的枚举上游未文档化,展示层不 hardcode 假设:未知窗口名原样展示。超限判定用 `percent >= 100` 而非字符串匹配 `status`,避免枚举猜测。解析层把键控对象归一化为固定顺序(rolling、weekly、monthly)的窗口数组,未知键排在已知键之后。

4. **渲染复用 Codex 的 `usageWindowLines` 进度条行。** 三窗口标签「5 小时 / 每周 / 每月」(rolling/weekly/monthly 精确映射,未知名原样);窗口数据归一化为 `{usedPercent, resetAt}` 后与 Codex 行完全同构,不扩展函数签名。reset 展示复用 Codex 的重置时间渲染(UTC `YYYY-MM-DD HH:MM`)。

5. **类型上 status surface 新增 `opencodeUsage` 字段,默认 `not_applicable`。** 现有所有 status surface 构造点补默认值,保证旧数据(无该字段的测试 fixture)继续可用。

## Risks / Trade-offs

- [`windows[].name`/`status` 实际枚举与假设不符] → 展示层宽容解析,未知值原样显示;拿到真实凭据联调后只需微调格式化层,不影响端口与门控。
- [`percent` 非常规值] → 上游为整数,解析层宽容小数并规范到 0–100 闭区间;字段缺失或非数字时该窗口判失败并整块降级。
- [上游端点未来变更或下线] → 查询失败走既有「不可用」降级,不阻塞 status 其余信息;无持久化状态需要迁移。
- [`resetsAt` 解析失败] → 该窗口判失败并整块降级,不展示猜测的重置时间。

## Migration Plan

纯新增,无数据迁移。回滚 = revert 单个提交;新字段默认 `not_applicable`,旧消费方不受影响。

## Open Questions

已确认(真实 key 联调):窗口键为 `rolling`/`weekly`/`monthly`,标签映射集中在渲染层一处,未知名原样展示。无遗留开放问题。
