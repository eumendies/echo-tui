## 1. 运行时解析

- [x] 1.1 调整 `src/config/llm-config.ts` 的 provider 解析结果，分别记录已解析 provider 与因未知 preset 被忽略的 provider id，并保持缺失 preset、类型错误及已知 preset 无效字段继续失败。
- [x] 1.2 调整 model profile 解析，只过滤引用已忽略 provider 的模型，同时保留模型引用完全不存在 provider、有效模型重复 id 和其他结构错误的现有校验。
- [x] 1.3 在过滤后的模型目录为空时返回不含敏感值的针对性错误，并确认有效模型目录继续复用 selectedModel 与 session sidecar 的现有回退逻辑。
- [x] 1.4 将非字符串 `selectedModel` 视为未配置，将无效 `contextWindow` 视为缺失并接入内置模型窗口或默认窗口回退。
- [x] 1.5 按 preset 语义读取 provider 字段：固定/隐藏 Base URL 时跳过用户 `baseURL` 校验，无需 API key 时让非字符串可选 `apiKey` 回退 preset 默认值或空值，同时保持实际生效字段严格校验。

## 2. 配置与运行边界

- [x] 2.1 确认 `/model`、status line 和 agent 装配只消费过滤后的运行时模型目录，未知 preset 不再把存在有效模型的配置置为 `model unavailable`。
- [x] 2.2 保持 `/config` 草稿读取未知 provider/model、严格拒绝保存未知 preset 且不自动改写原始配置，并补充必要的回归覆盖。

## 3. 自动化测试

- [x] 3.1 更新 `test/config/llm-config.test.js`，覆盖混合有效/未知 preset、未知 provider 关联模型过滤、selectedModel 回退、全部模型被过滤及错误脱敏。
- [x] 3.2 补充非字符串 `selectedModel`、无效 `contextWindow`、固定/隐藏 Base URL 下无效用户值，以及无需 key preset 下无效可选 `apiKey` 的安全回退测试。
- [x] 3.3 补充模型状态或命令层测试，验证 `/model` 仅展示有效候选、session 陈旧选择回退，并验证已知 preset 缺必要凭据、缺失 preset、错误 provider 引用和实际生效字段错误仍明确失败。

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`。
- [x] 4.2 运行 `npm test`。
- [x] 4.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`。
