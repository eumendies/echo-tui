## 1. 共享字节预算基础

- [x] 1.1 在工具公共模块中定义 65,536 bytes 默认结果上限，并补充 UTF-8 安全截头、截尾、字段裁剪和剩余预算计算能力，但不创建通用 `boundToolResult`
- [x] 1.2 调整 tool-result offloading 预览逻辑，使预览、分隔符、截断说明和 artifact marker 的最终总长度不超过调用方预算
- [x] 1.3 为共享预算和 offload helper 增加 ASCII、中文、emoji、极小预算、artifact 成功及 artifact 失败测试

## 2. Grep 与 Glob 收集边界

- [x] 2.1 为 `grep` 増加可测试覆盖的总输出字节选项，在收集阶段按格式化匹配行累计预算，并同步限制 `details.display.matches`
- [x] 2.2 处理单条超长 grep 匹配的 UTF-8 安全正文截断、字节/条数截断原因和 `has_more` 提示，并在达到限制后终止 rg
- [x] 2.3 为 `glob` 增加总输出字节选项，只收集预算内完整路径，并在字节或条数超限时终止 rg 和返回对应提示
- [x] 2.4 限制 grep JSON-line、glob NUL parser 的 pending buffer 及两者 stderr 捕获，覆盖缺少分隔符和超长错误输出的测试
- [x] 2.5 更新 grep/glob 工具定义，并测试默认限制、多字节内容、display 一致性及既有条数上限行为

## 3. Bash、文件读取与附件

- [x] 3.1 重构 Bash 结果格式化，使 command、状态、stdout、stderr、错误、marker 和截断提示共享 65,536 bytes 最终预算，并优先保留输出尾部
- [x] 3.2 保持 Bash 完整合并输出的流式 artifact 写入，补充双流累计超限、超长 command/error、artifact 成功和失败测试
- [x] 3.3 将 `read_files` 默认总文本结果上限收紧到 65,536 bytes，使普通文本、目录、PDF、失败摘要和 marker 都遵守最终预算并在适用时 offload
- [x] 3.4 为 `read_files` 增加单次图片附件 10,000,000 bytes 聚合限制，按请求顺序跳过超预算图片且不构造被排除的 Base64 attachment
- [x] 3.5 补充 read_files 分页/截断指引、批量文本、PDF、超长失败以及多图片累计边界测试

## 4. Web 与 MCP 结果边界

- [x] 4.1 使 `web_fetch` 的参数校验、网络错误、HTTP/媒体失败和成功/offload 路径全部遵守 65,536 bytes 最终预算
- [x] 4.2 使 `web_search` 的成功结果、单次 provider 失败和所有尝试失败摘要全部遵守 65,536 bytes 最终预算
- [x] 4.3 修正 MCP 预览语义，使成功内容、失败信息和 artifact marker 的完整结果均不超过现有 20,000 bytes 上限
- [x] 4.4 为 Web 和 MCP 增加超长外部错误、多字节截断、marker 计费及后续读取提示测试

## 5. Subagent 与 Skill

- [x] 5.1 将 `ToolResultStore` 注入 `run_subagent` handler，对成功回答和失败 handoff 返回 65,536 bytes 有界头部预览及可用 artifact 路径
- [x] 5.2 为 subagent 结果增加 artifact 不可用和多字节边界测试，并确认父 transcript 不保留无界外层 tool result
- [x] 5.3 为 `use_skill` arguments、资源列表和完整结果 envelope 增加字节校验；超出 65,536 bytes 时返回 source path 并指引通过 `read_files` 分页读取源文件，不返回部分指令
- [x] 5.4 补充 skill 恰好处于边界、超长正文、超长 arguments/资源和有界失败结果测试

## 6. 结构化交互与文件编辑结果

- [x] 6.1 为 Todo 单项及聚合文本增加输入字节限制，确保 create/complete 结果始终是不超过 65,536 bytes 的完整 JSON，且拒绝时不更新状态
- [x] 6.2 为 `ask_user_questions` 的问题、label、description 和聚合定义增加字节限制，在打开交互 surface 前拒绝超限调用
- [x] 6.3 为用户自定义回答增加交互期字节限制，并验证成功、取消和失败 tool result 均为预算内合法 JSON
- [x] 6.4 为 `apply_patch` 和 `edit_file` 的成功路径摘要、reason、hint 和文件系统异常增加字段级及最终字节限制，同时保留既有输入限制
- [x] 6.5 补充 Todo、用户提问和文件编辑工具的状态不变性、合法 JSON、长路径、长错误及 UTF-8 边界测试

## 7. 目录审计与验证

- [x] 7.1 审计默认内置工具 registry 和 MCP registry 中每个 handler，确认所有成功、失败、取消、超时和异常路径均由所属工具显式应用结果预算
- [x] 7.2 更新工具描述、截断文本和相关文档，明确分页、收窄查询、分批读取、分页读取 skill 源文件或读取 artifact 的继续方式
- [x] 7.3 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 7.4 手动验证 grep/glob 截断、Bash artifact、read_files 分页/图片批次、Web/MCP 长结果、subagent artifact、超大 skill 拒绝及 Todo/用户问题输入限制
