## 1. 用量查询模块

- [x] 1.1 新建 `src/config/opencode-usage.ts`:`OPENCODE_USAGE_URL` 常量、`isOpencodeGoBaseUrl` 门控(hostname 为 opencode.ai 且路径以 /zen/go/ 开头)、`OpencodeUsageError`(错误信息先脱敏再抛出)
- [x] 1.2 实现 `queryOpencodeUsage(apiKey, deps)`:Bearer GET `/zen/go/v1/usage`,严格校验 `plan / useBalance / windows[]`(used/limit/usagePercent/resetInSec 为有限数字,name/status 为非空字符串;usagePercent 缺失时按 used/limit 推导并规范到 0–100)
- [x] 1.3 新增 `test/config/opencode-usage.test.js`:门控(三预设命中/其它 baseURL 不命中/非法 URL)、解析(正常三窗口/残缺降级/百分比推导/HTTP 非 2xx/网络错误),deps 注入 fetch 与 usageUrl

## 2. 类型与 status 端口

- [x] 2.1 `src/types/command.ts` 新增 OpenCode 用量 surface 状态类型:`not_applicable / loading / available / unavailable`(结构对齐 Codex usage 与 DeepSeek balance)
- [x] 2.2 `src/app/command/status-command-ports.ts` 新增 `queryOpencodeUsage()` 端口:活动 config 错误 → `unavailable`;baseURL 不命中 → `not_applicable`(不发请求);查询失败 → `unavailable` 且错误信息脱敏
- [x] 2.3 端口测试:非 OpenCode baseURL 返回 `not_applicable` 且不产生网络请求;命中时透传查询结果

## 3. /status 面板

- [x] 3.1 `src/commands/status-command-handler.ts` 把该查询并入现有并行 provider 查询编排:loading 占位、同一 status session 内更新、迟到结果不覆盖已关闭 surface
- [x] 3.2 `src/render/footer/status-surface.ts` 渲染 OpenCode Go 用量区块:rolling/weekly/monthly 三窗口进度条、百分比、reset 时间;percent ≥ 100 用警示色;未知窗口名原样展示;归一化为 `{usedPercent, resetAt}` 后复用 `usageWindowLines`
- [x] 3.3 surface 渲染测试:available(三窗口)/ loading / unavailable 三态,及 `not_applicable` 时整个区块不渲染

## 4. 回归与收尾

- [x] 4.1 既有 status 相关测试与 fixture 适配 `opencodeUsage` 字段默认 `not_applicable`,全量回归零失败
- [x] 4.2 真实 OpenCode Go key 手测 `/status`:三窗口数值、超限警示、key 错误时「不可用」降级(不可用时依赖单测与模拟数据验证)
- [x] 4.3 完整验证序列:`npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;` 全过
- [x] 4.4 经用户确认后提交 dev;archive 时同步 delta 到主 spec(`openspec/specs/status-command/spec.md`)
