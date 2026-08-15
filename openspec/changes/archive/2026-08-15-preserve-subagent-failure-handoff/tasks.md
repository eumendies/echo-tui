## 1. 失败交接领域模型

- [x] 1.1 新增 Subagent failure handoff 的结构化快照、工具配对结果和预算配置类型，并按项目规范为字段补充中文领域注释
- [x] 1.2 实现单次子运行 accumulator，按稳定 record 顺序收集过程、维护当前 assistant streaming draft，并在 segment 稳定或切换后正确清理旧草稿
- [x] 1.3 为 accumulator 的稳定输出、旧 draft 清理、工具 call/result 配对及无结果调用识别添加纯单元测试

## 2. 有界 Handoff 构建与格式化

- [x] 2.1 实现纯 failure handoff builder，区分 stable、incomplete 和 uncertain 内容，并为无进展失败生成简短交接
- [x] 2.2 实现固定总字符预算、动态字段局部上限、确定性头尾截取、工具过程计数及省略/截断标记
- [x] 2.3 实现工具摘要投影：文件编辑提取结构化文件变化，Bash保留执行状态，读取/Web/MCP/未知工具生成通用有界摘要，附件只保留元数据
- [x] 2.4 为长输出、超量工具、文件变化、Bash/MCP状态不明、失败tool result、附件和预算不越界添加纯单元测试

## 3. Subagent 运行链路集成

- [x] 3.1 在 `SubagentToolPort` 的单一记录发布入口接入 accumulator，保证 interactive与headless使用同一运行事实且不反向依赖App或transcript store
- [x] 3.2 在Port失败边界区分局部简洁终态诊断和provider-facing handoff，不扩展外层结果字段，使failed rail保持简洁而`run_subagent` result返回完整有界交接
- [x] 3.3 保持成功结果、runtime启动前拒绝、父级取消、provider重试和`subagent` role过滤语义不变，并补充相应回归测试
- [x] 3.4 添加termination类provider失败集成测试，验证稳定assistant、已完成工具和未完成assistant draft进入外层失败结果，主loop取得结果后可继续continuation
- [x] 3.5 添加headless与自定义/Worker Subagent失败测试，验证无TUI callback时仍生成同一交接，潜在副作用和状态不明调用得到保守提示

## 4. 持久化与 Provider 投影回归

- [x] 4.1 验证失败终态record只保存简洁诊断、外层成对tool result保存handoff正文，且journal replay后顺序和内容保持有效
- [x] 4.2 验证主provider只接收外层`run_subagent` call/result和handoff正文，不接收本地Subagent records、内部tool call id、raw reasoning或provider-private记录
- [x] 4.3 验证现有紧凑外层结果和Subagent rail不重复展示大段handoff，失败过程及终态渲染保持现有宽度与主题行为

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`
- [x] 5.2 运行 `npm test`
- [x] 5.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
