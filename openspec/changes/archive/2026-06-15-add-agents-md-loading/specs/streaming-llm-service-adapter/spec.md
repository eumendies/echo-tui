## ADDED Requirements

### Requirement: provider system prompt 注入 AGENTS.md 指令
真实 LLM adapter 的 provider records 构建 SHALL 在内置 system prompt 中追加适用的 `AGENTS.md` 指令。AGENTS 指令 SHALL 作为 transient system prompt 内容参与模型请求，并 SHALL NOT 写入本地 transcript、持久化 session 或用户配置。内置运行时约束、tool 安全策略和当前交互模式 SHALL 优先于 AGENTS 指令；项目内更具体路径的 AGENTS 指令 SHALL 优先于项目根 AGENTS 指令；项目 AGENTS 指令 SHALL 优先于全局 AGENTS 指令。

#### Scenario: 构造 provider records 时包含全局 AGENTS
- **WHEN** `~/.echo/AGENTS.md` 存在且可读
- **AND** agent loop runtime 构造 provider records
- **THEN** 第一条 system record SHALL 包含该全局 AGENTS 指令内容
- **THEN** system record SHALL 标明该指令来自全局 AGENTS

#### Scenario: 使用项目根到 cwd 的 AGENTS 链路
- **WHEN** 当前 `cwd` 位于一个由 `.git` 或项目 `.echo` marker 判定出的项目根下
- **AND** 项目根到 `cwd` 的路径链路中存在一个或多个 `AGENTS.md`
- **THEN** 第一条 system record SHALL 按从项目根到 `cwd` 的顺序包含这些项目 AGENTS 指令
- **THEN** system record SHALL 为每个项目 AGENTS 标明相对项目路径

#### Scenario: 项目根使用最近 marker 判定
- **WHEN** 从当前 `cwd` 向父目录查找项目根
- **THEN** 系统 SHALL 使用最近的包含 `.git` 或项目 `.echo` marker 的目录作为项目根
- **THEN** `.git` marker SHALL 支持目录或文件形式
- **THEN** 项目 `.echo` marker SHALL NOT 把用户 home 下的全局 `~/.echo` 当作项目根

#### Scenario: 无项目 marker 时只读取 cwd AGENTS
- **WHEN** 从当前 `cwd` 向父目录没有找到 `.git` 或项目 `.echo` marker
- **THEN** 系统 SHALL 只尝试读取当前 `cwd/AGENTS.md`
- **THEN** 系统 SHALL NOT 继续读取父目录中的 `AGENTS.md`

#### Scenario: AGENTS 缺失或不可读时保持请求可用
- **WHEN** 全局或项目 `AGENTS.md` 缺失、不可读或不是可读取的普通文本文件
- **THEN** agent loop runtime SHALL 跳过该 AGENTS 文件
- **THEN** agent loop runtime SHALL 继续构造 provider records
- **THEN** 系统 SHALL NOT 因该 AGENTS 文件问题追加本地 transcript 错误记录

#### Scenario: AGENTS 内容受大小预算限制
- **WHEN** 单个 AGENTS 文件或全部 AGENTS 指令内容超过运行时大小预算
- **THEN** system prompt SHALL 只包含预算内的 AGENTS 内容
- **THEN** system prompt SHALL 对被裁剪内容显示 `truncated` 或等价提示
- **THEN** provider records SHALL 继续保留内置 system prompt、当前工作目录、plan mode 和 skill catalog 语义

#### Scenario: AGENTS 指令不覆盖内置 system prompt
- **WHEN** AGENTS 指令与源码内置 system prompt、tool 安全策略或 plan mode 约束冲突
- **THEN** system prompt SHALL 明确内置运行时约束和当前交互模式优先级更高
- **THEN** OpenAI provider agent SHALL 继续只转换传入 records 中已有的 system record
- **THEN** OpenAI provider agent SHALL NOT 自行读取 AGENTS 文件或生成额外 system prompt

#### Scenario: 无 AGENTS 时保持原请求形态
- **WHEN** 当前没有可用的全局或项目 AGENTS 指令
- **THEN** provider system prompt SHALL 保持不包含 AGENTS section
- **THEN** 普通 OpenAI input 转换、skill catalog 注入和工具 schema 发送语义 SHALL 保持不变
