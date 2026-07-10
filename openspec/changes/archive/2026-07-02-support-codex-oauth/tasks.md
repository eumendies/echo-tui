## 1. Codex OAuth 凭据读取与刷新

- [x] 1.1 梳理当前 Codex CLI file auth cache 的 JSON 结构，并为可识别字段定义最小运行时解析类型
- [x] 1.2 新增 Codex auth cache path 解析逻辑，按 provider 配置、`CODEX_HOME`、默认 `~/.codex/auth.json` 顺序定位文件
- [x] 1.3 实现 Codex OAuth credential parser，提取 access token、refresh token、过期时间和可选 account id，且不在错误中输出文件原文
- [x] 1.4 实现 access token 过期检测，支持从 JWT `exp` 或 auth cache 元数据解析过期时间
- [x] 1.5 实现 OAuth refresh token 请求，成功后只返回本进程内的新 credential，不回写 Codex auth cache
- [x] 1.6 为 auth cache 缺失、格式不可识别、access 未过期、access 过期刷新成功、刷新失败和敏感信息脱敏添加单元测试

## 2. Provider 配置与模型解析

- [x] 2.1 新增 `openai-codex-oauth` provider preset，固定 Codex backend Base URL 并标记为无需 API key
- [x] 2.2 扩展 LLM provider profile 类型和解析逻辑，支持 Codex OAuth credential source 与可选 auth cache path
- [x] 2.3 调整配置校验，确保 Codex OAuth provider 不要求 `apiKey`，但仍要求至少一个模型 profile
- [x] 2.4 确保现有 OpenAI Responses、OpenAI Chat-compatible、Anthropic-compatible、fixed Base URL provider 和 fake provider 配置行为不变
- [x] 2.5 更新配置读取、保存和默认 bootstrap 相关测试，覆盖 Codex OAuth provider 的 round-trip 与敏感字段不持久化

## 3. Codex backend Responses adapter

- [x] 3.1 扩展 provider agent setup，使 Codex OAuth provider 路由到 Responses-compatible adapter 或窄范围 Codex Responses adapter
- [x] 3.2 在 Codex provider request 前解析可用 OAuth credential，并把 access token 注入为 Bearer auth header
- [x] 3.3 为 Codex backend request 设置 `https://chatgpt.com/backend-api/codex` Base URL，并确保 SDK 最终请求 `/responses`
- [x] 3.4 在可解析 account id 时发送 `ChatGPT-Account-ID` header
- [x] 3.5 保持现有 Responses transcript conversion、tool schema、tool loop continuation、reasoning summary、usage 和 abort 语义
- [x] 3.6 为 Codex request client options、headers、Base URL、token refresh path、abort signal 和错误脱敏添加 adapter 测试

## 4. Codex 模型枚举

- [x] 4.1 扩展 provider model list resolver，支持 Codex OAuth preset 的模型枚举连接解析
- [x] 4.2 实现 Codex backend models endpoint 请求：`/models?client_version=1.0.0`
- [x] 4.3 从 Codex backend 响应中过滤可见模型 id，并保留手动添加模型的 fallback
- [x] 4.4 为模型枚举成功、空列表、鉴权失败、网络失败、响应格式无效和敏感信息脱敏添加测试

## 5. `/config` 交互

- [x] 5.1 更新 provider preset 列表展示，使 Codex OAuth 作为独立选项出现
- [x] 5.2 调整 provider 详情页，Codex OAuth provider 不展示 API key 输入，并展示 auth cache 状态摘要或缺失提示
- [x] 5.3 确保保存 Codex OAuth provider 时不写入 access token、refresh token 或伪 API key
- [x] 5.4 确保 Codex OAuth provider 的 `+ add model` 和 `list models` 交互符合现有 footer command surface 约束
- [x] 5.5 为 `/config` 读取、保存、取消、模型枚举失败和 UI 行生成添加聚焦测试

## 6. 文档、验证与收尾

- [x] 6.1 更新 `docs/README.md` 或相关配置文档，说明 Codex OAuth 需要已有 file-based Codex 登录态且本项目不执行登录
- [x] 6.2 更新架构文档中 LLM config、provider setup 和 OpenAI Responses adapter 说明
- [x] 6.3 运行 `npm run typecheck`
- [x] 6.4 运行 `npm test`
- [x] 6.5 运行 `find bin src test scripts -name '*.js' -exec node --check {} \\;`
- [x] 6.6 手动验证 `/config` 中新增 Codex OAuth provider、手动模型添加、模型枚举失败提示和一次 Codex backend 请求（未使用用户真实 Codex token 发起外部请求）
