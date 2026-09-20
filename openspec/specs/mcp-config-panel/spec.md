# mcp-config-panel Specification

## Purpose
定义 `/mcp` 多视图配置面板的外部行为：总览/server 编辑/集合子视图/只读清单/确认/错误的视图树与导航、server 字段与集合的草稿编辑与校验、环境变量与请求头的密钥掩码与"未改动"语义、显式保存的字段级写回与重载、以及运行事实与清单的只读浏览边界。
## Requirements
### Requirement: /mcp 面板的视图树与导航
`/mcp` command session SHALL 使用单一 surface kind 上的 `view` 判别联合承载多级视图：`overview`（一级总览，进入入口）、`server`（单个 server 的编辑与事实视图）、`entries` 与 `entryDetail`（集合字段子视图）、`inventory`（只读清单）、`discardConfirm`、`deleteConfirm` 与 `error`。视图切换 SHALL 只修改 command session 的草稿与视图状态，SHALL NOT 直接写盘或触发 MCP 重连。每一层的行集合 SHALL 由 handler 与 renderer 共用的纯函数投影，避免动态焦点错位。

#### Scenario: 打开面板进入总览
- **WHEN** 用户提交 `/mcp`
- **THEN** 系统 SHALL 打开 `view: 'overview'` 的 command session
- **THEN** composer SHALL 被清空且 footer 显示面板而不是普通输入区

#### Scenario: 进入与返回 server 视图
- **WHEN** 总览中选中一个 server 行并按 Enter
- **THEN** 面板 SHALL 切换到该 server 的 `server` 视图
- **THEN** 在 server 视图按 Esc SHALL 返回总览且不写盘

#### Scenario: 从 server 视图进入清单并返回
- **WHEN** server 视图中选中 Tools、Resources 或 Prompts 入口并按 Enter
- **THEN** 面板 SHALL 切换到对应 `inventory` 视图
- **THEN** 在 inventory 按 Esc SHALL 返回该 server 视图

### Requirement: server 编辑表单与草稿校验
server 视图 SHALL 允许编辑 `enabled`、`transport`、`url`、`command`、`args`、`cwd`、`env`、`headers` 与 `timeoutMs`（`url` 与 `command` 按 transport 互斥呈现），并 SHALL 支持新增 server 与删除 server（删除需确认）。面板 SHALL 支持草稿级校验：名称为空或重复、stdio 缺少 `command`、http 缺少 `url`、`timeoutMs` 超出既有合法区间时，保存 SHALL 被拒绝并把问题逐条呈现，草稿 SHALL 保留。编辑场景 SHALL NOT 沿用运行时的静默名称归一（非法名称必须可见）。

#### Scenario: 编辑标量字段
- **WHEN** 用户在 server 视图选中 `timeoutMs` 行并输入合法数字
- **THEN** 草稿 SHALL 更新该字段
- **THEN** 系统 SHALL NOT 立即写盘

#### Scenario: 切换 transport 改变可见字段
- **WHEN** 用户把 transport 从 `stdio` 切到 `http`
- **THEN** server 视图 SHALL 呈现 `url` 行并隐藏 `command`/`cwd` 行
- **THEN** 草稿 SHALL 保留另一 transport 已填写的字段值

#### Scenario: 新增 server
- **WHEN** 用户在总览选择 `[新增 server]`
- **THEN** 系统 SHALL 以草稿内唯一的占位名新增该 server 并直接进入其 server 视图
- **THEN** server 视图 SHALL 以名称行作为首行，用户可在该行把占位名改为目标名称
- **THEN** 名称为空或与草稿中其它 server 重名时 SHALL 拒绝提交并保留原草稿值
- **THEN** 该 server SHALL 在保存前不出现在运行时目录中

#### Scenario: 删除 server 需要确认
- **WHEN** 用户在 server 视图选择删除并在确认页确认
- **THEN** 草稿 SHALL 移除该 server
- **THEN** 取消确认 SHALL 保留该 server 且不修改草稿

#### Scenario: 非法草稿被拒绝
- **WHEN** 草稿中存在空名称、重名、stdio 缺 `command`、http 缺 `url` 或 `timeoutMs` 越界
- **THEN** 保存 SHALL 被拒绝并切换到 `view: 'error'` 逐条列出问题
- **THEN** 草稿 SHALL 完整保留以便修正

### Requirement: 集合字段的增删改子视图
`args`、`env`、`headers` SHALL 各自提供 `entries` 列表与 `entryDetail` 编辑子视图，支持新增条目、编辑键与值、删除条目。`args` SHALL 以声明顺序呈现并保持顺序语义；`env` 与 `headers` SHALL 以键名呈现并在保存时按当前顺序写回。子视图中的修改 SHALL 只作用于草稿。

#### Scenario: 新增键值条目
- **WHEN** 用户在 `env` 的 entries 视图新增一条键值
- **THEN** 草稿 SHALL 包含该键值且顺序在末尾

#### Scenario: 编辑与删除条目
- **WHEN** 用户在 entryDetail 修改键或值，或在 entries 视图删除某条
- **THEN** 草稿 SHALL 反映该修改
- **THEN** 系统 SHALL NOT 立即写盘

#### Scenario: args 顺序即语义
- **WHEN** 用户编辑 `args` 条目
- **THEN** 面板 SHALL 以序号行呈现顺序
- **THEN** 保存后配置中的 `args` 数组顺序 SHALL 与面板呈现一致

### Requirement: 密钥字段的掩码与未改动语义
`env` 与 `headers` 的值 SHALL 以掩码（`••••`）呈现，明文 SHALL NOT 出现在面板投影中。编辑密钥值时空输入 SHALL 表示"未改动"并保留配置中的原值；清空已有值 SHALL 需要显式清空操作。草稿 SHALL 用"未改动"与"空值"两种可区分状态表达这两条路径。

#### Scenario: 掩码展示
- **WHEN** 某 server 的 `headers` 含 `Authorization` 并有值
- **THEN** entries 与 entryDetail SHALL 以掩码呈现该值
- **THEN** 面板投影 SHALL NOT 包含明文凭据

#### Scenario: 空输入保留原值
- **WHEN** 用户在密钥值的编辑缓冲中不输入任何字符并提交
- **THEN** 草稿 SHALL 标记该值为"未改动"
- **THEN** 保存后配置中的原值 SHALL 保持不变

#### Scenario: 显式清空
- **WHEN** 用户对某密钥值使用显式清空操作
- **THEN** 草稿 SHALL 记录为空值
- **THEN** 保存后该键的值 SHALL 被写入为空字符串或按既定语义移除，且与"未改动"路径可区分

### Requirement: 显式保存、字段级写回与重载
保存 SHALL 只由显式保存行触发，并且 SHALL 按字段级合并写回：只更新面板展示字段，保留 server 节点上的未知字段与历史字段；写盘 SHALL 保持原子替换语义。保存成功后系统 SHALL 重载 MCP manager、清理 context usage 并给出成功反馈；写盘失败 SHALL 展示错误且保留草稿。存在未保存改动时离开面板 SHALL 先经过丢弃确认。

#### Scenario: 保存成功
- **WHEN** 用户在无校验问题的草稿上触发保存
- **THEN** 系统 SHALL 写回配置、重载 MCP manager 并清理 context usage
- **THEN** 面板 SHALL 显示保存成功反馈，且脏检查基线 SHALL 更新

#### Scenario: 保留未展示字段
- **WHEN** 某 server 节点包含面板未展示的字段（例如未知键或历史 `approval`）
- **THEN** 保存后这些字段 SHALL 原样保留

#### Scenario: 写盘失败保留草稿
- **WHEN** 配置写入失败
- **THEN** 面板 SHALL 展示失败原因
- **THEN** 草稿 SHALL 不被清空，用户可修正后重试

#### Scenario: 丢弃确认
- **WHEN** 草稿存在未保存改动且用户按 Esc 离开或触发关闭
- **THEN** 系统 SHALL 先展示丢弃确认
- **THEN** 确认丢弃 SHALL 关闭面板且不写盘，取消 SHALL 返回原视图

### Requirement: 运行事实与只读清单
server 视图 SHALL 展示该 server 的运行事实：声明的 capability（tools/resources/prompts）、三类条目计数、只读工具数与配置诊断。`inventory` 视图 SHALL 只读呈现 tools（含只读标记与描述）、resources（uri、名称、mimeType，含 resource templates）与 prompts（命令名与参数签名）。清单数据 SHALL 来自 manager 的既有缓存，面板 SHALL NOT 为此发起新的 MCP 调用或连接；未初始化或配置无效的 server SHALL 只展示配置与诊断，清单入口 SHALL 以不可用状态呈现。

#### Scenario: 展示运行事实
- **WHEN** 用户进入已初始化 server 的 server 视图
- **THEN** 面板 SHALL 展示 capability 与三类计数
- **THEN** 存在诊断时 SHALL 展示诊断摘要

#### Scenario: 浏览三类清单
- **WHEN** 用户在 inventory 视图查看 tools、resources 或 prompts
- **THEN** 面板 SHALL 分别呈现名称/只读标记/描述、uri/名称/mimeType（templates 另列）、命令名与参数签名
- **THEN** 面板 SHALL NOT 执行或触发任何 MCP 调用

#### Scenario: 无效 server 的清单不可用
- **WHEN** 某 server 配置无效或未初始化成功
- **THEN** 其 server 视图 SHALL 展示配置字段与诊断
- **THEN** 清单入口 SHALL 以不可用状态呈现而不是展示空清单

