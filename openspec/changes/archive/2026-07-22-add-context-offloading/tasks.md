## 1. Offloading 存储与预览基础能力

- [x] 1.1 新增 cwd 项目分区下的 tool result store，支持安全目录/文件名、临时文件原子落位、单文件硬上限和失败清理
- [x] 1.2 新增 UTF-8 安全的 head/tail preview 与统一 `[tool result truncated: <absolute-path>]` marker 组装逻辑，不向结果添加其他字段
- [x] 1.3 为短文本、head、tail、超长多字节字符、写入失败、硬上限和最终路径可读性补充单元测试

## 2. Bash 工具与 shell mode

- [x] 2.1 扩展共享 Bash runner，在输出超过 preview 上限后流式写入合并终端输出，并以 bounded buffers 保留 stdout、stderr 和合并输出尾部
- [x] 2.2 更新 `run_bash_command` 超限结果，使其保留既有命令/退出状态、在输出前放置统一 marker、返回尾部预览并继续设置 `truncated: true`
- [x] 2.3 更新 shell mode 最终 transcript，使 shell ctx 使用 offloading 文件和合并输出尾部，shell-local 完整写入本地 transcript，且 shell ctx provider 投影保持 bounded
- [x] 2.4 补充 Bash 成功/失败/超时/中断、stdout/stderr 混合顺序、offloading 失败降级和 shell transcript 恢复测试

## 3. Web Fetch 与 MCP

- [x] 3.1 在 `web_fetch` 完成 HTML/text 投影和结果格式化后应用 head offloading，保留网络响应读取硬上限与现有分页语义
- [x] 3.2 在 MCP text、structured content 和 legacy tool result 格式化后应用 head offloading，保留 call id、tool name、`ok` 和纯文本 continuation 语义
- [x] 3.3 更新默认工具 registry、agent setup 和 MCP registry 装配，使相关 handler 共享当前 cwd 的 tool result store
- [x] 3.4 补充 Web Fetch 与 MCP 的未超限、超限、UTF-8 边界、统一 marker、文件回读和写入失败降级测试

## 4. Transcript 与上下文集成验证

- [x] 4.1 验证 tool result 和 shell record 只持久化 bounded preview 与 marker，JSONL journal 不复制完整 offloading 内容
- [x] 4.2 验证 OpenAI Responses、OpenAI Chat、Anthropic 和 Codex continuation 接收相同 bounded 文本，并可通过 `read_files` 或 `grep` 使用 marker 中的绝对路径
- [x] 4.3 验证 context token 估算和 compaction summary 只消费 bounded transcript 文本，且 TUI renderer 能安全显示统一 marker

## 5. 文档与验证

- [x] 5.1 更新架构文档，说明 tool-results 项目分区、支持 offloading 的工具、head/tail 策略、硬上限和暂不自动 GC 的取舍
- [x] 5.2 依次运行 `npm run typecheck`、`npm test` 和 JavaScript 语法检查，并记录需要用户手动验证的 Bash、shell mode、Web Fetch、MCP 与 `/resume` 场景

## 6. Review 修复

- [x] 6.1 修复 Bash 流式 artifact 的严格 head 语义、跨 chunk UTF-8、文件权限和 MCP fallback 语义，并移除未使用的 offloading API
- [x] 6.2 补充 hard cap、UTF-8 chunk、写入失败、timeout/中断、stdout/stderr 顺序和 MCP 精确回读测试，修正回退后的 Responses 断言并重新运行全量验证

## 7. PDF 已提取文本

- [x] 7.1 扩展 proposal、design 和 specs，定义 PDF metadata + head + marker、完整格式化结果落盘、既有 PDF 硬上限与失败降级语义
- [x] 7.2 将共享 `ToolResultStore` 注入默认 `read_files` handler，在成功 PDF 提取的最终格式化边界应用 UTF-8 安全 head offloading
- [x] 7.3 补充未超限、超限精确 artifact 回读、UTF-8 边界、写入失败与 transcript/session 只持久化 bounded 结果测试
- [x] 7.4 更新架构文档，并依次运行 typecheck、全量测试、JavaScript 语法检查与 `git diff --check`

## 8. PDF 独立预览阈值

- [x] 8.1 更新 proposal、spec 和 design，将 PDF 默认模型可见阈值设为独立的 65,536 bytes，并保持普通 `read_files` 的 256,000-byte 总输出上限
- [x] 8.2 新增 `maxPdfOutputBytes` 限制并在 PDF 最终格式化边界与总输出上限取较小值
- [x] 8.3 更新阈值、PDF offloading 和非 PDF 总输出回归测试及架构文档
- [x] 8.4 依次运行 typecheck、全量测试、JavaScript 语法检查与 `git diff --check`
