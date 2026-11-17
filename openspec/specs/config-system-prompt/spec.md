# config-system-prompt Specification

## Purpose
定义 `/config` 常规 Tab 的系统提示词入口，以及 `SYSTEM.md` 的查看、编辑、删除与回落行为：文件快照与生效来源、按钮式管理视图、只读阅读与折行、原子写入、交互层级与失败处理，并保持运行时签名与 headless 语义不变。
## Requirements
### Requirement: 常规 Tab 提供系统提示词入口
配置中心“常规”Tab SHALL 在“项目指令文件”行之后提供一行只读摘要“系统提示词”，用于标识当前生效的基础 system prompt 来源，并作为进入系统提示词管理视图的唯一入口。该行值 SHALL 为以下三态之一：`项目 SYSTEM.md`、`全局 SYSTEM.md`、`内置默认`。该行 SHALL NOT 展示文件体积或行数，避免把导航行变成第二份状态面板。

该行 SHALL 只承担导航职责：SHALL NOT 拥有独立草稿、SHALL NOT 参与常规设置 draft 校验、SHALL NOT 参与常规 Tab 的 dirty fingerprint 计算。其显示值 SHALL 来自磁盘快照，且 SHALL 在打开配置中心、从系统提示词视图返回常规 Tab、以及系统提示词写入或删除成功后刷新；普通 footer 渲染热路径 SHALL NOT 同步读取该文件。

#### Scenario: 展示项目级摘要
- **WHEN** 项目根存在非空可读的 `SYSTEM.md`
- **THEN** 常规 Tab SHALL 显示 `项目 SYSTEM.md` 形式的摘要
- **THEN** 该行 SHALL NOT 标记常规 Tab 为 dirty

#### Scenario: 展示全局级摘要
- **WHEN** 项目根不存在有效 `SYSTEM.md`，且 `~/.echo/SYSTEM.md` 非空可读
- **THEN** 常规 Tab SHALL 显示 `全局 SYSTEM.md` 形式的摘要

#### Scenario: 无覆盖文件时展示内置默认
- **WHEN** 项目级与用户级 `SYSTEM.md` 都不存在或内容为空
- **THEN** 常规 Tab SHALL 显示 `内置默认`

#### Scenario: 打开管理视图
- **WHEN** 用户在常规 Tab 选中“系统提示词”行并按 Enter
- **THEN** 系统 SHALL 打开系统提示词管理视图
- **THEN** 系统 SHALL NOT 追加 transcript record、SHALL NOT 启动 agent loop、SHALL NOT 进入 tool approval flow、SHALL NOT 切换 terminal alternate screen

### Requirement: 系统提示词文件快照
系统 SHALL 在打开管理视图时构建一次文件快照，包含两个写入目标的绝对路径、存在性与行数，以及当前生效来源与其基础文本内容。项目目标路径 SHALL 为“项目根/`SYSTEM.md`”，项目根 SHALL 沿用 `AGENTS.md` 相同的项目根判定口径；不存在 `.git` 或 `.echo` 标记时 SHALL 以当前 cwd 作为项目根。全局目标路径 SHALL 为 `~/.echo/SYSTEM.md`。

快照 SHALL NOT 修改任何文件，且 SHALL 容忍单个目标读取失败：读取失败的目标 SHALL 以不可用状态呈现并附带可读中文原因，SHALL NOT 阻断另一目标或整个配置中心。空文件 SHALL 视为“不存在”，与运行时 loader 语义一致。

#### Scenario: 两个目标同时存在
- **WHEN** 项目根与 `~/.echo/` 都存在有效的 `SYSTEM.md`
- **THEN** 快照 SHALL 包含两个目标的绝对路径、存在性与行数
- **THEN** 当前生效来源 SHALL 为项目级

#### Scenario: 单个目标读取失败
- **WHEN** 项目级 `SYSTEM.md` 存在但不可读，且全局文件可读
- **THEN** 视图 SHALL 在项目目标上呈现读取失败原因
- **THEN** 全局目标 SHALL 继续正常展示
- **THEN** 系统 SHALL NOT 因此关闭配置中心

#### Scenario: 空文件等价于不存在
- **WHEN** 目标文件只包含空白字符
- **THEN** 快照 SHALL 把该目标标记为不存在
- **THEN** 生效来源 SHALL 回落到下一优先级或内置默认

### Requirement: 按钮式管理视图
系统提示词管理视图 SHALL 由一个状态区和一个固定顺序的可操作行列表组成，SHALL NOT 使用字母快捷键触发操作。可操作行顺序 SHALL 为：“查看当前生效的 system prompt”“编辑项目 SYSTEM.md”“编辑全局 SYSTEM.md”“删除项目 SYSTEM.md”“删除全局 SYSTEM.md”“返回常规设置”。handler 与 renderer SHALL 共用同一份行集合投影，避免焦点与渲染错位。

状态区 SHALL 展示三行事实：“当前生效”（来源文件名）、“项目文件”（绝对路径、存在性与行数）、“全局文件”（同上）。状态区 SHALL NOT 展示文件体积（字节数）。视图 SHALL 另行展示动态段摘要，列出 `Runtime environment`、`AGENTS.md`、`Skills`、`Memory` 各段的来源摘要与估算 token 数，并 SHALL 明确标注这些段由运行时拼装、不可在视图中编辑。单个动态段解析失败 SHALL 只影响该段展示，SHALL NOT 阻断视图。

Up 与 Down SHALL 只在可操作行之间移动焦点，Enter SHALL 执行当前行，Esc SHALL 返回常规 Tab。视图 SHALL NOT 注册 footer hit region，也 SHALL NOT 提供鼠标点击或滚轮操作。footer 高度不足时 SHALL 优先保留状态区与当前焦点行，动态段摘要 MAY 被省略或截断；高度连两行都放不下时 MAY 只保留当前焦点行。

#### Scenario: 固定按钮集合
- **WHEN** 管理视图处于 menu 状态
- **THEN** 视图 SHALL 依次显示六个可操作行
- **THEN** 视图 SHALL NOT 显示 `e`、`g`、`r` 之类的字母操作快捷键提示

#### Scenario: 焦点只在按钮间移动
- **WHEN** 用户在 menu 状态按 Up 或 Down
- **THEN** 系统 SHALL 在当前可操作行列表中移动焦点并停在边界
- **THEN** 系统 SHALL NOT 滚动状态区或动态段摘要

#### Scenario: 极小高度保留焦点
- **WHEN** footer 可用高度不足以容纳状态区、六个按钮与动态段摘要
- **THEN** 视图 SHALL 保留状态区与包含当前焦点的按钮窗口
- **THEN** 动态段摘要 SHALL 被省略而不是挤掉当前焦点行

#### Scenario: 动态段摘要降级
- **WHEN** 某个动态段无法解析来源（例如模型配置不可读导致 skills 估算失败）
- **THEN** 该段 SHALL 显示降级说明
- **THEN** 其余动态段与全部按钮 SHALL 继续可用

#### Scenario: 不响应鼠标
- **WHEN** 当前活跃 command session 是配置中心的系统提示词视图
- **THEN** command runtime SHALL 报告该 handler 未提供 pointer 能力
- **THEN** 点击 footer SHALL NOT 改变该视图状态

### Requirement: 查看当前生效的基础 system prompt
“查看当前生效的 system prompt”行 SHALL 打开只读阅读态，标题 SHALL 标明当前生效来源（项目级、全局级或内置默认）。正文 SHALL 展示当前生效的基础文本并带行号，SHALL NOT 拼接 runtime environment、项目指令、skill catalog 或 memory 段落。

阅读态 SHALL 支持 Up 与 Down 逐行滚动、PageUp 与 PageDown 翻页，Esc SHALL 返回 menu。阅读态 SHALL NOT 写入任何文件，也 SHALL NOT 修改 command session 之外的 app 状态。

正文 SHALL 按当前终端宽度折行显示，长逻辑行 SHALL 完整可见，SHALL NOT 用省略号截断行尾内容。折行续行 SHALL NOT 重复逻辑行号。行号宽度 SHALL 随正文逻辑行总数自适应。正文超长时 SHALL 使用滚动窗口，SHALL NOT 一次性输出超过 footer 高度的行；滚动偏移 SHALL 以折行后的物理行为单位，并由 handler 与 renderer 共享同一次宽度投影计算上限。

#### Scenario: 查看项目级覆盖内容
- **WHEN** 生效来源为项目级 `SYSTEM.md`，用户执行“查看当前生效”
- **THEN** 阅读态标题 SHALL 包含“项目 SYSTEM.md”
- **THEN** 正文 SHALL 逐行对应项目文件内容

#### Scenario: 长行折行而非截断
- **WHEN** 生效文本中存在超过正文宽度的逻辑行
- **THEN** 阅读态 SHALL 把该逻辑行折成多个物理行并完整展示
- **THEN** 续行 SHALL NOT 重复该逻辑行的行号
- **THEN** 正文 SHALL NOT 出现省略号截断

#### Scenario: 查看内置默认
- **WHEN** 两个覆盖文件都不存在，用户执行“查看当前生效”
- **THEN** 阅读态标题 SHALL 标明“内置默认”
- **THEN** 正文 SHALL 为源码内置基础 prompt 文本

#### Scenario: 滚动与返回
- **WHEN** 阅读态正文超过可见高度
- **THEN** Down 与 Up SHALL 逐行调整滚动偏移，PageDown 与 PageUp SHALL 按窗口高度翻页
- **THEN** Esc SHALL 返回 menu，且滚动偏移 SHALL 重置

#### Scenario: 阅读态只读
- **WHEN** 用户处于阅读态
- **THEN** 系统 SHALL NOT 写盘、SHALL NOT 修改 transcript、SHALL NOT 清空 context usage

### Requirement: 编辑并原子写入 SYSTEM.md
“编辑项目 SYSTEM.md”与“编辑全局 SYSTEM.md”两行 SHALL 分别进入编辑态，并分别只写各自目标文件；系统 SHALL NOT 提供写入目标切换开关或复用同一个编辑入口。编辑态 SHALL 预填目标文件当前内容；目标文件不存在时 SHALL 预填内置默认基础文本，使“新建”与“修改”使用同一交互。

编辑态 SHALL 使用多行 composer 语义：Enter SHALL 进入保存确认而不直接写盘，Ctrl+J SHALL 插入换行，Esc SHALL 丢弃草稿并返回 menu。编辑器 SHALL NOT 截断内容或按行数拒绝输入。编辑态 SHALL 按当前终端宽度折行显示草稿，长行 SHALL 完整可见，真实光标位置 SHALL 与折行后的物理行列一致。

保存确认态 SHALL 展示目标绝对路径与是否覆盖已存在文件，SHALL NOT 展示字节数或行数变化；SHALL 支持 Up 与 Down 在两个选项间切换、Enter 执行、Esc 返回编辑态。写入内容 SHALL 与运行时 loader 使用同一归一化口径：CRLF 与 CR 归一为 LF，并去除首尾空白。写入 SHALL 在父目录缺失时递归创建，并使用同目录临时文件加 rename 原子替换目标文件；失败时 SHALL NOT 留下半写入或损坏的 `SYSTEM.md`。

归一化后内容与现有文件逐字相同时，系统 SHALL 跳过写盘并提示内容未变化。归一化后内容为空时，系统 SHALL 拒绝保存并提示改用删除动作，SHALL NOT 写入空文件。

写入成功后系统 SHALL 重新读取文件快照、返回 menu、显示包含“下一轮 assistant run 生效”的成功提示，并使已缓存的 context usage 失效；内容未变化而未写盘时 SHALL NOT 触发失效。

#### Scenario: 编辑项目文件
- **WHEN** 用户在 menu 选择“编辑项目 SYSTEM.md”且项目文件存在
- **THEN** 编辑态 SHALL 预填项目文件内容
- **THEN** 保存确认 SHALL 只以项目根 `SYSTEM.md` 为目标路径

#### Scenario: 新建全局文件
- **WHEN** 用户选择“编辑全局 SYSTEM.md”且 `~/.echo/SYSTEM.md` 不存在
- **THEN** 编辑态 SHALL 预填内置默认基础文本
- **THEN** 保存确认 SHALL 标明这是新建而非覆盖
- **THEN** 写入 SHALL 在 `~/.echo/` 不存在时创建该目录

#### Scenario: 保存需要确认
- **WHEN** 用户在编辑态按 Enter
- **THEN** 系统 SHALL 进入保存确认态
- **THEN** 系统 SHALL NOT 在确认前写入文件

#### Scenario: 归一化与原子写入
- **WHEN** 用户确认写入包含 CRLF 与首尾空白的草稿
- **THEN** 落盘内容 SHALL 使用 LF 并已去除首尾空白
- **THEN** 目标文件 SHALL 由同目录临时文件 rename 替换

#### Scenario: 内容未变化
- **WHEN** 归一化后的草稿与目标文件现有内容逐字相同
- **THEN** 系统 SHALL NOT 写入文件
- **THEN** 视图 SHALL 提示内容未变化并返回 menu

#### Scenario: 拒绝写入空内容
- **WHEN** 归一化后的草稿为空
- **THEN** 系统 SHALL 拒绝保存并提示改用删除动作
- **THEN** 系统 SHALL NOT 创建或清空目标文件

#### Scenario: 写入失败保留草稿
- **WHEN** 写入因权限或磁盘错误失败
- **THEN** 系统 SHALL 停留在确认态或编辑态并显示可读错误
- **THEN** 用户已输入的草稿 SHALL 保留，允许重试

### Requirement: 删除覆盖文件并回落
“删除项目 SYSTEM.md”与“删除全局 SYSTEM.md”两行 SHALL 只删除各自目标文件本身，SHALL NOT 删除所在目录或其他文件。目标文件不存在时，该行 SHALL 保持可见但呈现为不可用；Enter SHALL 只给出“文件不存在”提示，SHALL NOT 写盘或触发删除。

删除前 SHALL 进入确认态，展示将被删除的绝对路径与删除后的回落目标（另一目标的路径或内置默认）。确认执行后，文件不存在（ENOENT）SHALL 视为删除已完成，SHALL NOT 报错。删除成功后系统 SHALL 重新读取文件快照、返回 menu、显示包含回落来源的成功提示；仅当确实删除了文件时 SHALL 使已缓存的 context usage 失效，ENOENT 不得触发无意义的失效。

#### Scenario: 删除项目覆盖后回落到全局
- **WHEN** 项目级与全局级 `SYSTEM.md` 都存在，用户确认删除项目文件
- **THEN** 确认态 SHALL 标明删除后将回落到 `~/.echo/SYSTEM.md`
- **THEN** 删除成功后常规 Tab 摘要 SHALL 刷新为全局来源

#### Scenario: 删除唯一覆盖后回落到内置
- **WHEN** 只有全局级 `SYSTEM.md` 存在，用户确认删除该文件
- **THEN** 确认态 SHALL 标明删除后将回落到内置默认
- **THEN** 删除成功后常规 Tab 摘要 SHALL 刷新为 `内置默认`

#### Scenario: 删除不存在的文件
- **WHEN** 目标文件不存在且用户激活对应的删除行
- **THEN** 系统 SHALL 只显示“文件不存在”提示
- **THEN** 系统 SHALL NOT 进入确认态、SHALL NOT 删除任何路径

#### Scenario: 删除只影响目标文件
- **WHEN** 用户确认删除项目级 `SYSTEM.md`
- **THEN** 系统 SHALL NOT 删除项目根目录、`AGENTS.md`、`.echo/` 或全局 `SYSTEM.md`

### Requirement: 运行期语义保持不变
本次视图 SHALL NOT 改变既有的 system prompt 加载与注入语义：生效来源优先级仍然为项目级 `SYSTEM.md`、用户级 `~/.echo/SYSTEM.md`、源码内置 prompt；覆盖文件 SHALL 只替换基础文本段，runtime environment、`AGENTS.md` 指令链、skill catalog 与 memory sections SHALL 继续由运行时追加到同一 system record。

视图中的写入与删除 SHALL 在下一轮 assistant run 生效；同一 run 内（含 tool call continuation）SHALL 继续使用启动时冻结的基础文本。子 Agent 运行 SHALL 继续继承父 run 冻结的基础文本与指令链。headless `echo-tui --once` SHALL 读取同一份文件并遵循同一优先级，SHALL NOT 因本视图获得额外 UI 行为。

写入成功或确实删除了文件后，系统 SHALL 使已缓存的 context usage 快照失效，避免 `/context` 展示陈旧占用。系统 SHALL NOT 因为文件变化追加 transcript record、改写 transcript journal 或写入 `~/.echo/config.json`。

#### Scenario: 下一轮生效
- **WHEN** 用户在视图中保存项目级 `SYSTEM.md`
- **THEN** 下一次 assistant run SHALL 使用新基础文本构造 system record
- **THEN** 保存前已启动、仍在进行的 run SHALL NOT 中途替换基础文本

#### Scenario: 动态段不被覆盖
- **WHEN** 任一覆盖文件生效
- **THEN** system record SHALL 继续包含 runtime environment、`AGENTS.md` 指令、skill catalog 与 memory sections

#### Scenario: 不污染配置与历史
- **WHEN** 用户通过视图保存或删除 `SYSTEM.md`
- **THEN** 系统 SHALL NOT 修改 `~/.echo/config.json`
- **THEN** 系统 SHALL NOT 追加或改写 transcript records

#### Scenario: headless 路径同源
- **WHEN** 用户通过视图写入项目级 `SYSTEM.md`，随后执行 `echo-tui --once "..."`
- **THEN** headless run SHALL 使用该文件作为基础 system prompt

### Requirement: 交互层级与配置中心边界
系统提示词视图是配置中心内部的一级子视图，SHALL 复用配置中心 session，SHALL NOT 新开 command session。

在 menu 或阅读态按 Tab，系统 SHALL 退出该子视图并切换到下一个配置 Tab；在编辑态与确认态按 Tab，系统 SHALL 忽略该事件。Esc 的层级 SHALL 自内向外为：确认态 → 编辑态或 menu，编辑态 → menu，阅读态 → menu，menu → 常规 Tab。回到常规 Tab 后，其它 Tab 的草稿与子页面现场 SHALL 保持不变。

子视图 SHALL NOT 参与配置中心的 `discardConfirm` dirty 统计。未保存的编辑草稿 SHALL 在 Esc、Tab 退出或配置中心关闭时被丢弃，SHALL NOT 触发全局放弃确认，也 SHALL NOT 写入任何文件。

#### Scenario: Tab 从 menu 切走
- **WHEN** 用户处于 menu 状态并按 Tab
- **THEN** 系统 SHALL 关闭系统提示词视图并切换下一个 Tab
- **THEN** 系统 SHALL NOT 写入任何文件

#### Scenario: 编辑态忽略 Tab
- **WHEN** 用户处于编辑态并按 Tab
- **THEN** 系统 SHALL 保持编辑态不变
- **THEN** 当前 Tab SHALL NOT 发生切换

#### Scenario: Esc 逐层回退
- **WHEN** 用户依次从保存确认态、编辑态、阅读态按 Esc
- **THEN** 系统 SHALL 依次返回编辑态、menu、menu
- **WHEN** 用户在 menu 按 Esc
- **THEN** 系统 SHALL 返回常规 Tab 并保持配置中心 session 活跃

#### Scenario: 未保存草稿不进入放弃确认
- **WHEN** 用户在编辑态修改内容后按 Esc，随后在主视图按 Esc 关闭配置中心
- **THEN** 系统 SHALL NOT 把该编辑草稿计入未保存 Tab 列表
- **THEN** 系统 SHALL NOT 写入或残留任何草稿内容

### Requirement: 视图能力分层与错误处理
命令 handler SHALL 通过 `CommandHost` 暴露的配置端口完成快照读取、写入与删除，SHALL NOT 直接访问文件系统、renderer、terminal 或完整 `AppContext`。路径解析、快照构建、内容归一化与原子写入 SHALL 与运行时 loader 位于同一模块并复用同一常量，避免 UI 与运行期口径漂移。

读取、写入或删除失败 SHALL 在视图内以可读中文呈现，SHALL NOT 抛出到命令 runtime 之外、SHALL NOT 中断整个配置中心。任何失败路径 SHALL NOT 静默创建、覆盖或删除文件。

#### Scenario: 只经端口访问文件
- **WHEN** 用户执行任意查看、编辑或删除操作
- **THEN** 文件读写 SHALL 只发生在 config 端口实现中
- **THEN** handler SHALL 只消费结构化结果

#### Scenario: 读取失败降级展示
- **WHEN** 配置文件权限不足导致读取失败
- **THEN** 视图 SHALL 展示失败原因并保持可导航
- **THEN** 用户 SHALL 仍能返回常规 Tab 或切换其它配置 Tab

#### Scenario: 归一化口径同源
- **WHEN** 视图写入内容并在下一轮 run 被 loader 读取
- **THEN** 落盘内容 SHALL 已经是 loader 归一化后的等价形式
- **THEN** loader 再次读取 SHALL NOT 产生额外的首尾空白或行尾差异

