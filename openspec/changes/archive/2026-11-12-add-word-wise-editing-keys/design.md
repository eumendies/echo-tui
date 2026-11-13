## Context

composer 的光标模型是 grapheme 数组（`ComposerState.chars` + `cursor`），所有编辑操作最终都收敛到 `replaceRange()`，由它统一维护 `fileMentions` 的坐标。词级编辑不需要新的状态，只需要新的边界计算和新的输入事件。

输入侧的关键约束是 `parseKeyChunk()` 的匹配顺序：

1. `parseBracketedPasteAt()`
2. `parseTerminalReportAt()`（SGR 鼠标 + cursor position report）
3. `findSequenceAt()`（`KEY_SEQUENCES` 表）
4. 逐字符 `parseCharacter()`

`parseTerminalReportAt()` 用 `isCursorPosition = /^\x1b\[\d*;\d*/` 做**前缀探测**，命中后用 `findCompleteCsiEnd()` 找任意 CSI 终结字节（`0x40`–`0x7e`）。而 `D`、`~` 都落在这个区间，于是带修饰键的 CSI 序列在到达 `findSequenceAt()` 之前就被吞成空事件。

实测确认（当前构建）：

```
ESC[12;40R  => [cursor_position row:12 column:40]   真 CPR，正常
ESC[1;5D    => []                                    Ctrl+←，被吞
ESC[3;5~    => []                                    Ctrl+Delete，被吞
ESC[3~      => [delete_forward]                      普通 Delete，正常
```

所以在 `KEY_SEQUENCES` 里加序列**不足以**让这些键生效。

## Goals / Non-Goals

**Goals:**

- composer 支持按词移动光标（前/后）和删除后一个词
- 让终端已经在发送的 CSI 修饰键序列真正生效，按键有确定反馈
- 修复 CPR 前缀探测过宽的根因，使「未注册 CSI 被静默吞掉」不再掩盖已注册序列
- 词边界规则与既有 `Ctrl+W` 完全一致

**Non-Goals:**

- 不引入 CJK 词边界，仍按「连续空白 / 连续非空白」切分
- 不引入 kitty keyboard protocol，因此真 `Ctrl+Backspace` 仍无法区分
- 不覆盖非 xterm 风格的变体编码（如 rxvt 的 `ESC[5D` 表示 Ctrl+←）
- 不引入 keymap 配置文件或可重映射机制

## Decisions

### 决策 1：把 `findSequenceAt()` 提到 `parseTerminalReportAt()` 之前

这是本次唯一有风险的改动，必须先定。

**备选 A（选定）**：调整 `parseKeyChunk()` 的匹配顺序为 bracketed paste → `findSequenceAt` → `parseTerminalReportAt`。
`findSequenceAt` 是精确字符串前缀匹配，只认 `KEY_SEQUENCES` 里已注册的完整序列，不会误伤其他内容；未注册的 CSI 继续落到 `parseTerminalReportAt` 走既有兜底吞掉逻辑。

**备选 B（否决）**：把 `isCursorPosition` 收紧为完整匹配 `/^\x1b\[\d+;\d+R$/`。
看似更对症，但会破坏 `parseKeyChunk()` 的无状态容错：真实 CPR 被拆包时，半截 `ESC[12;4` 将不再被识别为「未终结的终端报告」，会退化成一串 `UNKNOWN` + 普通文本。当前跨 chunk 保留依赖 `splitTrailingControlPrefix()` 的 `isIncompleteCursorPosition` 分支，两边正则必须成对维护，改动面比调顺序更大。

**验证依据**：现有 `KEY_SEQUENCES` 中所有含 `[` 的序列（`ESC[A`~`ESC[D`、`ESC[H`、`ESC[F`、`ESC[1~`、`ESC[3~`、`ESC[4~`、`ESC[5~`、`ESC[6~`）都不含 `;`，不会命中 CPR 前缀，因此调换顺序对既有按键零影响。

**实施补充：裸 ESC 必须让位**。调换顺序后立刻暴露一个隐藏耦合——`KEY_SEQUENCES` 里存在长度为 1 的裸 `\x1b`（`ESCAPE`）。它作为前缀会匹配任何以 ESC 开头的序列的首字节，使终端报告退化成逐字符文本：

```
ESC[12;40R  => [escape, text:'[', text:'1', ...]   ← 回归
ESC[<0;5;6M => [escape, text:'<', ...]             ← 回归
```

修正方式是让 `findSequenceAt()` 只匹配长度大于 1 的序列。单字节控制键（`\x1b`、`\x7f`、`\x01`、`\n`、`\r`、`\t`）本来就能经 `parseCharacter()` 查同一张表命中，输出完全一致，因此该收窄零行为变化。这条约束已写入 `findSequenceAt()` 的注释，避免后续再往前置位置加规则时重现同一问题。

### 决策 2：事件命名与 `DELETE_PREVIOUS_WORD` 保持对称

新增三个语义事件，统一用 `PREVIOUS` / `NEXT` 而不是 `LEFT` / `RIGHT`：

```
MOVE_PREVIOUS_WORD
MOVE_NEXT_WORD
DELETE_NEXT_WORD
```

理由：既有 `DELETE_PREVIOUS_WORD` 已经用了 `PREVIOUS`，`DELETE_NEXT_WORD` 与之构成镜像，测试和日志里成对出现可读性更好。`MOVE_LEFT` / `MOVE_RIGHT` 描述的是字符级位移，词级用方位词会让两组事件的关系变得含糊。

### 决策 3：切词抽一个共享 helper，三个函数复用

现有 `deletePreviousWord()` 的算法是两段循环：先跳连续空白，再吃连续非空白。新增的 `movePreviousWord`、`moveNextWord`、`deleteNextWord` 是同一算法的三种消费方式（改 cursor / 删区间）。

抽一个内部函数计算边界：

```
findPreviousWordStart(chars, cursor) -> number
findNextWordEnd(chars, cursor)       -> number
```

这属于 AGENTS.md 允许的「移除有意义重复」：四处同构循环留在原地会让后续调整切词规则必须同步改四遍。

### 决策 4：删除必须走 `replaceRange`

`deleteNextWord()` 用 `replaceRange(composer, cursor, wordEnd, '')`，不能直接操作 `chars`。只有 `replaceRange` 会按编辑区间判定资格并重映射 `fileMentions`。移动函数只改 `cursor`，不触碰引用。

### 决策 5：只注册标准 xterm 编码

| 动作 | 序列 | 来源 |
| --- | --- | --- |
| `MOVE_PREVIOUS_WORD` | `ESC[1;5D` | Ctrl+← |
| `MOVE_PREVIOUS_WORD` | `ESC[1;3D` | Alt+← |
| `MOVE_NEXT_WORD` | `ESC[1;5C` | Ctrl+→ |
| `MOVE_NEXT_WORD` | `ESC[1;3C` | Alt+→ |
| `DELETE_NEXT_WORD` | `ESC[3;5~` | Ctrl+Delete |
| `DELETE_NEXT_WORD` | `ESC[3;3~` | Alt+Delete |

不猜测其他终端变体。`KEY_SEQUENCES` 已按序列长度降序排序，`ESC[1;5D` 不会被 `ESC[1~` 之类短前缀抢占。

### 决策 6：同时注册 ESC 前缀序列，覆盖 macOS 的 Option 映射

决策 5 的 CSI 编码在 Linux/Windows 终端上成立，但 macOS 上主流终端默认不这么发：

- iTerm2 默认把 `Option+←` 绑到 *Send Escape Sequence* `b`，`Option+→` 绑到 `f`
- Terminal.app 开启 "Use Option as Meta key" 后，`Option+←` 同样发 `ESC b`

若只支持 CSI 形式，macOS 用户按 `Option+←` 会得到 `escape` + `text:"b"` 两个事件——先触发 Esc 的中断路径，再把字母插入 composer。这比按键无反应更糟，因此必须一并处理。

追加注册 4 个长度为 2 的 ESC 前缀序列：

| 动作 | 序列 | 来源 |
| --- | --- | --- |
| `MOVE_PREVIOUS_WORD` | `ESC b` | Option+← / Alt+B |
| `MOVE_NEXT_WORD` | `ESC f` | Option+→ / Alt+F |
| `DELETE_NEXT_WORD` | `ESC d` | Option+D |
| `DELETE_PREVIOUS_WORD` | `ESC DEL` | Option+⌫ |

**关键判断：跨 chunk 合并已经就绪，不需要重写解析器。** `StatefulKeyParser` 在收到单独的 `\x1b` 时会置 `normalPending` 并让 `hasPendingEscape()` 返回 true，`InputEventController` 随即启动 30ms 等待窗口；窗口内后续字节到达时，`consumeNormal()` 会先把 `normalPending` 拼回再解析。因此只要注册长度 2 的序列，`ESC b` 被拆包时仍能命中。

**与裸 ESC 的关系**：决策 1 的「`findSequenceAt` 只匹配长度大于 1 的序列」恰好是这里的前提——`ESC b` 长度 2 参与匹配，而裸 `\x1b` 仍由 `parseCharacter()` 兜底。两个决策彼此依赖，不能单独回退。

**替代方案（否决）**：要求用户改终端 key mapping 把 `Option+←` 改成发 `ESC[1;3D`。iTerm2 可行，Terminal.app 无法自定义，且把配置负担转嫁给用户。

## Risks / Trade-offs

- **[调整解析顺序可能影响鼠标/CPR 行为]** → 现有含 `;` 的已注册序列为零，且新增测试显式覆盖「真 CPR 仍被识别为 `cursor_position`」和「未注册 CSI 仍被静默吞掉」两条反向断言。
- **[macOS 上 Ctrl+←/→ 被系统抢占]**（Mission Control 切换桌面）→ 同时提供 Alt+←/→；在帮助文案中标注两者等价。该限制属于操作系统层面，程序侧无法规避。
- **[中文整段删除]** → 本次明确不改切词规则，`Ctrl+W`、Alt+Delete 行为完全一致，不产生新的不一致；CJK 词边界作为后续独立变更。
- **[Alt+←/→ 依赖终端把 Option 当 Meta 或直接发 CSI 编码]** → CSI 编码不依赖 Meta 设置，比 `Alt+B/F` 更可靠；若终端不发该序列则按键无反应，与当前状态一致，不构成回归。
- **[`ESC[3;3~` 等序列在个别终端可能被解释为其他语义]** → 仅在明确注册的完整序列上生效，未注册序列的兜底行为不变。
- **[`ESC b` 与「Esc 中断后立刻打 b」存在理论歧义]** → 两者只有在落入同一个 stdin chunk（或跨 chunk 的 30ms 等待窗口）时才会混淆。真人连续两次按键的间隔远大于该窗口；且该歧义仅在同时注册前后才存在，此前 `ESC b` 本来就会被错误拆成中断 + 插字。测试覆盖两个方向：同 chunk 的 `ESC b` 产生移动事件，落单的 `\x1b` 仍产生 `escape`。
