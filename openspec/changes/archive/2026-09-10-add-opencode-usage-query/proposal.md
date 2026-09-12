## Why

OpenCode Go 订阅的 5 小时/每周/每月美元配额目前只能在上游 console 查看;echo-tui 已为 Codex OAuth(限额用量)与 DeepSeek(官方余额)提供 /status 内查询,opencode-go 系列预设却没有任何用量查询,体验不一致。上游已部署 `GET https://opencode.ai/zen/go/v1/usage`(Bearer API key 鉴权;无凭据探测返回 401 证实路由已存在),补齐该查询无需浏览器会话或 console 抓取。

## What Changes

- 新增 `src/config/opencode-usage.ts`:`queryOpencodeUsage(apiKey, deps)` 调用 `/zen/go/v1/usage` 并严格校验 `usage` 键控窗口响应(status/percent/resetsAt);`isOpencodeGoBaseUrl(baseURL)` 按 hostname 与 `/zen/go/` 路径前缀门控,一并覆盖 `opencode-go`、`opencode-go-responses`、`opencode-go-anthropic` 三个预设
- status 命令端口新增 `queryOpencodeUsage()`:活动 config 错误 → `unavailable`;baseURL 不命中 → `not_applicable`(不发请求);查询失败 → `unavailable`,错误信息脱敏
- `/status` 面板新增 OpenCode Go 用量区块:5 小时 / 每周 / 每月三窗口,展示百分比进度条与 reset 时间;加载中/不可用状态与 Codex/DeepSeek 区块一致
- status 命令的并行 provider 查询编排中加入该查询
- 测试:门控、响应解析(正常/残缺/HTTP 错/网络错)、端口门控、surface 渲染三态

## Capabilities

### New Capabilities

(无;查询模块为内部实现,规范级行为归属既有 status-command capability)

### Modified Capabilities

- `status-command`: 新增「查询 OpenCode Go 订阅用量」与「status surface 展示 OpenCode Go 用量」两条 requirement,结构对齐既有 Codex 用量 requirement

## Impact

- 代码:`src/config/opencode-usage.ts`(新)、`src/types/command.ts`、`src/app/command/status-command-ports.ts`、`src/commands/status-command-handler.ts`、`src/render/footer/status-surface.ts`
- 网络:仅 /status 触发时新增一路 Bearer 鉴权 GET;失败降级为「不可用」,不影响其余 status 信息,不追加 transcript record
- 测试:新增 `test/config/opencode-usage.test.js` + 既有 status 相关测试扩展;无破坏性变更
