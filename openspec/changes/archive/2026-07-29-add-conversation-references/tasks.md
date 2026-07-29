## 1. 引用数据与历史会话读取

- [x] 1.1 扩展 transcript/user metadata 和 command/render 类型，定义内部会话来源、`full | summary` 投影模式及可重放引用卡片所需字段，确保 provider-facing 引用不输出独立 session id 或时间 metadata。
- [x] 1.2 扩展 transcript store/context 的只读历史访问，返回 replay 后最终 session、源 journal 绝对路径和从第一条有效 user 消息派生的有界标题，并排除当前 session 候选。
- [x] 1.3 为历史会话标题、source path、truncate 后最终状态和无效 journal 过滤补充持久化层单元测试。

## 2. 会话引用投影与总结

- [x] 2.1 实现 replay 后 records 到中立引用文本的纯投影，保留有效 user/assistant 及有界上下文记录，过滤本地反馈、reasoning summary、provider-private extension 和已 truncate 内容，并避免跨 session 工具协议对象合并。
- [x] 2.2 使用现有 token estimator 和 `max(2000, min(12000, floor(contextWindow * 0.10)))` 预算实现短会话 `full`、长会话 `summary` 分流。
- [x] 2.3 实现无工具、无普通 reasoning 参数且可取消的引用总结调用，生成覆盖完整有效会话的结构化总结，同时不修改源 session compaction 或 journal。
- [x] 2.4 实现最小 provider-facing 引用包装，只包含标题、`source_file`、全量正文或总结、历史上下文边界和当前请求；summary 模式提示按需复用现有 `read_files`，不新增专用工具。
- [x] 2.5 为 records 过滤、工具文本中立化、预算边界、总结成功/空结果/失败/取消及最小引用格式补充单元测试。

## 3. `/reference` 选择与 transient 状态

- [x] 3.1 新增独立 ConversationReferenceContext，管理单个 pending 引用、准备状态、AbortController、替换和清理，不把投影正文写入 composer 字符数组。
- [x] 3.2 新增 `/reference` command handler 和受控 command-host 端口，复用历史会话列表/预览交互，确认完整 session 后准备附件，且不恢复或替换当前 transcript。
- [x] 3.3 注册 `/reference` slash descriptor 并更新 `/help` 等命令文案；实现无候选、加载失败、总结失败和可取消准备状态的 footer 反馈。
- [x] 3.4 为命令匹配、候选排除、单会话确认、已有引用替换、空状态、失败和 Esc 取消补充 command/controller 测试。

## 4. Composer、提交与渲染集成

- [x] 4.1 在 composer footer 中渲染待提交对话引用卡片，保持文本编辑、光标计算、输入历史和现有 file picker/slash surface 优先级不受引用正文影响。
- [x] 4.2 在普通消息提交前将准备完成的引用投影与当前请求组合为 user `text`，保持 `displayText` 为当前输入，并持久化 replay 渲染所需 metadata。
- [x] 4.3 在 transcript user block replay 中渲染简洁引用卡片；卡片显示标题和必要模式提示，不显示 session id、updatedAt 或展开后的长正文。
- [x] 4.4 串联成功提交、显式取消、`/clear`、`/resume` 和应用退出时的 pending 引用清理，并在长引用准备期间阻止重复提交和不安全的会话切换。
- [x] 4.5 为 composer 卡片、user block replay、提交文本展开、后续 turn 不重复展开和各清理生命周期补充 app/render 测试。

## 5. 验证与文档

- [x] 5.1 更新用户文档，说明 `/reference` 的整会话选择语义、短会话全量导入、长会话总结、`source_file` 与现有 `read_files` 按需读取行为。
- [x] 5.2 运行 `npm run typecheck` 并修复全部类型错误。
- [x] 5.3 运行 `npm test` 并修复全部自动化测试失败。
- [x] 5.4 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;` 完成 JavaScript 语法检查，并整理需要用户手动验证的 `/reference` 交互清单。
