## Context

Echo TUI 当前的消息复制主要依赖终端鼠标选区。用户消息为了视觉区分会渲染前缀和灰底，跨行复制时容易把 `▌`、缩进或其他装饰字符一起复制进去。由于终端选区复制的是屏幕字符，应用无法可靠声明“可见但不可复制”的字符，因此更稳妥的方向是新增语义化 `/copy` 命令，从 transcript 原始记录中选择并复制消息正文。

现有 slash command 架构通过 `CommandRuntime` 管理会话和输入分发，通过 `CommandHost` 暴露受控 app 能力。新增命令应遵守这一边界：handler 不能直接访问完整 `AppContext`、renderer 或 terminal controller。现有 file picker surface 已有两栏 footer 布局、列表窗口化、右侧预览和高度预算处理，可作为视觉与交互参考，但 copy command 不应复用文件选择器的数据类型。

## Goals / Non-Goals

**Goals:**

- 提供 `/copy` 命令，让用户通过键盘选择一条或多条 user/assistant 消息并复制原文。
- 保持当前 transcript 渲染样式不变，避免为复制体验牺牲视觉表达。
- 新增独立 copy surface，采用左侧消息列表、右侧全文预览的两栏 footer UI。
- 通过 `CommandHost` 暴露受控 transcript 读取与 clipboard 写入能力。
- 在复制成功、无可复制消息、无选中消息或剪贴板不可用时给出清晰反馈。

**Non-Goals:**

- 不修改用户消息、assistant 消息或 Markdown 的现有渲染前缀。
- 不提供鼠标点击选择、范围选择或全文搜索过滤。
- 不把 tool call/result、reasoning、shell、error、local notice 等记录纳入复制面板。
- 不强制引入第三方剪贴板依赖或 TUI 库。

## Decisions

1. **新增 `copy` command surface，而不是复用 `file_picker` surface 类型。**

   `file_picker` 绑定了路径、目录、query、文件类型和 selectedPaths 等文件语义。copy 面板需要表达 transcript record、role、时间、消息正文、选中消息 id/index 和复制状态。复用视觉语言可以降低认知成本，但复用类型会让语义混杂，增加后续维护成本。

2. **复制数据来自 transcript 原始记录，只允许 user/assistant。**

   handler 通过 `CommandHost.transcript.listCopyableRecords()` 获取可复制记录。host 负责从 app 状态筛选 user 和 assistant 记录，并投影为稳定的 copy item。这样 command handler 不需要理解完整 transcript 内部结构，也不会误把 provider-private reasoning 或 tool 记录暴露给复制面板。

3. **剪贴板写入通过 `CommandHost.clipboard.writeText()`。**

   clipboard 是跨平台系统能力，不应散落在 command handler 或 renderer 中。host 能力可以封装 macOS `pbcopy`、Windows `clip`、Linux `wl-copy`/`xclip`/`xsel` 等策略，并把失败原因归一化给 handler 展示。第一版不要求 OSC 52，避免终端兼容性和安全策略差异。

4. **默认聚焦并选中最近一条 assistant 消息；如果不存在 assistant，则选中最近一条可复制消息。**

   最常见场景是复制刚刚的 assistant 回复。默认选中能减少按键步骤，同时用户仍可用 Space 调整选择。若 transcript 里只有 user 消息，则选择最近的 user 消息。

5. **单条复制仅复制正文，多条复制附带角色标题。**

   单条复制应尽量干净，不额外添加 `User:` 或 `Assistant:`。多条复制需要保留上下文边界，格式为角色标题加正文，消息之间用空行分隔。角色标题可使用英文 `User:`/`Assistant:`，便于粘贴到 prompt、issue 或其他工具中继续使用。

6. **复制成功后关闭 surface，并追加本地可见反馈。**

   成功复制是一次本地动作，应让用户明确知道已经完成。反馈可以通过 local notice 或等价的本地提示展示，不应触发 agent turn，也不应改变被复制消息内容。

## Risks / Trade-offs

- **剪贴板命令在部分 Linux 环境不可用** → `clipboard.writeText` 返回结构化失败，surface 或 local notice 提示安装/启用可用剪贴板工具。
- **多条消息复制格式可能不符合所有用户偏好** → 第一版采用简单稳定格式，后续可再扩展 `/copy --raw` 或配置项。
- **长消息右侧预览可能占用 footer 高度** → renderer 复用现有高度预算、窗口化和裁剪策略，保证不破坏主界面。
- **transcript record 没有稳定 UI id** → host 可按当前 transcript 顺序生成 copy item id/index；copy 会话期间使用快照，避免 active transcript 变化导致选择错位。
- **复制成功反馈如果追加 transcript 可能污染可复制列表** → 仅 user/assistant 会进入 copy 面板，本地反馈不影响下一次 `/copy` 的可复制记录范围。
