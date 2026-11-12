## Context

三个模块各自对行尾做了**局部合理**的处理，组合后互相抵消：

| 位置 | 行为 | 单独看是否合理 |
| --- | --- | --- |
| `read-files/text-reader.ts` | `readline` 的 `crlfDelay: Infinity` 剥掉 `\r` | 合理：模型不应看到控制字符 |
| `apply-patch-tool-handler/parser.ts:35` | `patch.replace(/\r\n?/g, '\n')` | 合理：补丁格式不应依赖行尾 |
| `apply-patch-tool-handler/simulator.ts:532` | 按 `'\n'` 切分，行尾残留 `\r` | **不合理**：与上面两条不成对 |

前两条把 `\r` 从"模型可见的信息"里彻底移除，第三条却仍在"字节世界"里带着 `\r` 做精确比较。结果是模型既看不到问题、也表达不出问题、更无法通过重读来发现它。

约束条件是：`read_files` 的归一化行为是对的，不能为了让补丁能匹配而把 `\r` 重新暴露给模型；同时写回不能把 CRLF 文件整体转成 LF，否则会制造全文件 diff。因此正确方向是**只在字节侧补齐归一化与还原，两侧信息模型保持不变**。

## Goals / Non-Goals

**Goals:**

- CRLF 与 LF 文件对同一份补丁、同一个 `old_string` 产生一致结果
- 写回保留目标文件原有行尾风格，不产生全文件 diff
- 含裸 `CR` 的文件不再静默塌成单行并报「匹配 0 处」，改为明确的行尾不支持错误
- 展示行不带行尾分隔符字符

**Non-Goals:**

- 不改变 `read_files` 的返回格式，不新增行尾提示字段
- 不引入 `.gitattributes`、`.editorconfig` 或 `core.autocrlf` 的读取
- 不支持混合行尾文件逐行保留（见决策 2）
- 不改变工具定义 schema、审批策略、change history 与写入安全边界
- 不处理二进制检测、编码检测或 BOM

## Decisions

### 决策 1：匹配在行尾归一化视图上进行，行尾随行携带

`splitFileContent()` 不再返回裸字符串数组，而是返回带分隔符的行对象：

```ts
type ContentLine = {
  text: string;      // 剥离分隔符的行内容
  separator: string; // 该行之后的分隔符；'' 表示文件到此结束且无尾换行
};
```

拼接是 `lines.map((line) => line.text + line.separator).join('')`，因此**不需要独立的 `trailingNewline` 标志**——末尾换行状态由最后一项的 `separator` 表达。

`findFirstMatch()` 只改一处比较：`lines[index + offset].text !== target[offset]`。补丁侧不需要改动，`parser.ts` 已把 hunk 行归一化为无 `\r`。

这样匹配语义从「字节精确」变为「行内容精确」，`\r` 不再参与比较，既有形如 `line1` 的 hunk 对 CRLF 文件同样成立。

**替代方案（否决）**：维护 `lines: string[]` 与 `eols: string[]` 两个平行数组。`applySequentialUpdateHunks()` 有两处数组替换（纯插入、区间替换），每次都要同步 splice 两个数组，编译器无法保证同步，漏一次就是行尾整体错位。行对象把行尾与内容绑成不可分割的单元，替换天然同步。

**替代方案（否决）**：让 `splitFileContent` 按 `/\r\n|\r|\n/` 切分但把 `\r` 留在行内。这解决不了匹配失败，因为 hunk 行没有 `\r`。

### 决策 2：逐行保留未修改行的原始分隔符

写回不在文件级别统一行尾，而是逐行复用各自的 `separator`。这直接保护既有 `edit_file` requirement 中的「未命中区域的文件内容 SHALL 保持不变」——该约束对混合行尾文件同样成立。

**关键：hunk 的 context 行必须复用原 `ContentLine` 对象，不能整段重建。**

`parser.ts` 在解析 hunk 时，context 行会**同时**进入 `oldLines` 和 `newLines`（第 317–320 行），而 `applySequentialUpdateHunks()` 用 `newLines` 整段替换 `oldLines` 区间。如果对整段 `newLines` 无差别创建新行对象，hunk 内未修改的 context 行也会被赋上主流行尾——恰好违反要保护的不变量。

反例：原文 `keep\nold\r\nend\r\n`，补丁把 `old` 改为 `new`、`keep` 与 `end` 作为 context。整段替换会把 `keep` 的 `\n` 改写成 `\r\n`。

因此替换内容必须按 `hunk.displayLines` 逐项重建，而不是直接使用 `newLines`：

| displayLines 项 | 处理 |
| --- | --- |
| `context` | 复用 `currentLines[sourceIndex]`，原 `separator` 原样保留 |
| `removed` | 跳过，`sourceIndex` 前进 |
| `added` | 新建 `{text, separator: mainEol}` |

只有 `added` 行需要行尾决策，统一采用文件主流行尾：统计 `\r\n` 与独立 `\n` 的出现次数取多数派，无换行时默认 `\n`。

新增行不追随局部风格，因为新内容本身没有"原有行尾"，而跨行替换区间内部可能同时存在两种风格，无从推断。用主流行尾是唯一无歧义且稳定的规则：纯 CRLF 的 `.bat` 文件新增行仍是 CRLF，混合文件新增行跟随多数派，不会产生"半行 CRLF 半行 LF"。

`separator` 的边界规则：

| 场景 | 处理 |
| --- | --- |
| 替换区间末尾是 `context` 行 | 复用原对象，尾换行状态自然保持 |
| 替换区间末尾是 `added` 行，且后面仍有未修改行 | 主流行尾 |
| 替换区间末尾是 `added` 行，且位于文件末尾 | 继承被替换区间最后一项的 `separator` |
| 末尾纯插入 | 前一行原为 `''` 则补主流行尾；原文件无尾换行则最后一个新行保持 `''` |
| 纯删除到末尾 | 新的最后一行继承被删区间的 `separator` |

把「文件末尾是否有换行」挂在被替换区间最后一个 `separator` 上接力传递，编辑就不会意外增删尾换行。

**替代方案（否决）**：文件级统一重建。对纯 LF 与纯 CRLF 文件等价，但对混合行尾文件会改写全部少数派行，制造用户没有预期的大 diff，并与既有 `edit_file` requirement 冲突。

**替代方案（否决）**：检测到混合行尾直接拒绝。安全但可用性差——混合文件通常是可修复的（仓库配置漂移、多编辑器协作、合并残留），拒绝会让 agent 卡在一个它能绕开的问题上。

### 决策 3：`edit_file` 在归一化视图上匹配和替换

`simulateEdit()` 目前直接在 `content` 上 `indexOf`。改为：

1. 归一化 `content` 与 `oldString`（`\r\n` → `\n`），并同步建立 `offsetMap[normalizedOffset] = originalOffset`
2. 在归一化文本上定位全部匹配与非重叠区间
3. `newString` **先归一化再转入目标行尾**：`normalizeEol(newString).replace(/\n/g, mainEol)`。直接对原始 `newString` 执行 `replace(/\n/g, '\r\n')` 会在输入本身已是 CRLF 时产出 `\r\r\n`——实测 `"x\r\ny"` 得到 `"x\r\r\ny"`
4. 按 span 重新拼接：未命中区间用 `content.slice(offsetMap[prev], offsetMap[next])` **原样拷贝原文**，替换区间写入第 3 步的结果

**归一化后重新判定空操作。** 现有 `args.old_string === args.new_string` 检查发生在归一化之前，因此 `old_string` 用 LF、`new_string` 用 CRLF 描述同一段文本时会漏过。归一化后应重新比较：相同则返回「无实际变化」失败，不写盘、不计入 change history，与现有空操作失败语义一致。

未命中区间走原文切片，因此逐字节不变——对混合行尾文件同样成立，且连行内裸 `\r` 都原样保留。这比行对象方案更精确，因为 `edit_file` 是字符串级操作，没有"行"的概念需要维护。

代价是需要一次 O(n) 的映射构建，但 `edit_file` 本来就要整文件读入内存并做多次 `indexOf`，量级不变。

**display metadata 必须同源归一化。** `createEditFileDisplayFile(before, after, spans)` 内部用 `lineIndexAtOffset()` 把字符偏移换算成行号。`spans` 来自归一化视图，`CRLF` 每行比 `LF` 多一个字符，若把含 `\r` 的原始文本配上一组归一化偏移，行索引会逐行累积错位。

因此 `simulateEdit()` 需要把归一化后的 before/after 一并交给 display，而不是让 handler 传原始 `loaded.value`。行级投影只关心行内容，归一化不丢失任何展示信息，也不会把 `\r` 泄漏到展示行。

报告给模型的 `replacementCount` 与 `spans` 仍基于归一化视图计算，与最终写入的字节长度无关。

### 决策 4：包含裸 CR 的文件明确拒绝

检测条件：内容中存在不构成 `CRLF` 的 `CR` 字节，即某个 `\r` 后面不是 `\n`。命中时 handler 返回 `ok: false`，原因说明目标文件包含裸 `CR` 行尾、当前仅支持 `LF` 与 `CRLF`，且不写入任何文件。`CR`-only 文件是本条件的一个特例。

**为什么不在工具内部支持裸 CR**：三处外部约束无法同时满足。

| 环节 | 实测行为 |
| --- | --- |
| `read_files`（`readline`） | 把裸 `\r` 切成换行，模型看到的是多行 |
| 补丁 parser | `patch.replace(/\r\n?/g, '\n')` 把裸 `\r` 转成 `\n` |
| display 展示 | 行内 `\r` 写入终端会让光标回到行首，破坏 footer 投影 |

如果工具内部把裸 `\r` 当作行内容，模型读到的行数就与工具内部的行数不一致，补丁行数永远无法对齐。这比现状更隐蔽——双方各自都自洽，却互相不匹配。与其定义一套模型无法表达的行模型，不如直接拒绝并说明原因。

拒绝范围覆盖全部文件操作：`Add File` 不读取目标文件，天然不受影响；`Update File`、`Delete File` 与 `edit_file` 都必须在读取后执行该检查，否则 `Delete File` 记录下来的 removed 行会是整文件一行。

### 决策 5：展示行剥离分隔符

`createResolvedDisplayLines()` 与 `simulateDeleteFile()` 使用的 `line.text` 在决策 1 之后天然不含 `\r`，无需额外处理。

这一点顺带修掉实测中 `Delete File` 的 `displayFile.lines` 为 `["line1\r","line2\r"]` 的问题——`\r` 进入 terminal 写入会让光标回到行首，可能破坏 footer 投影。

由于决策 4 拒绝了含裸 `CR` 的文件，展示层不会遇到「必须保留行内 `\r`」与「展示行不得含 `\r`」的冲突。

### 决策 6：`read_files` 保持不变

归一化匹配生效后，模型不需要知道目标文件的行尾风格就能正确编辑，因此不为 `read_files` 增加 `line endings: CRLF` 之类的提示字段。

这避免了工具结果噪声，也避免把"如何应对 CRLF"的知识重新推给模型。行尾是字节层事实，应由工具内部处理，不应成为模型的负担。

## Risks / Trade-offs

- **[混合行尾文件的新增行使用主流行尾，与相邻行可能不一致]** → 新增行没有可继承的原有行尾，且跨行替换区间内部可能两种风格并存，无从推断局部风格。主流行尾是唯一无歧义规则；未修改行仍逐行保留原分隔符，测试覆盖「未修改行字节不变」与「新增行采用主流行尾」两条独立断言。
- **[行对象重构触及 `applySequentialUpdateHunks` 的两处数组替换]** → 这是本次改动最集中的风险点。`separator` 与 `text` 绑定在同一对象上，插入/替换/删除都不会出现两数组错位；用既有 `LF` 测试全量回归，并新增尾换行保持用例。
- **[`edit_file` 的偏移映射构建有额外内存开销]** → 映射与原文字符数同阶，与已经整文件读入的内存占用相比可忽略；`edit_file` 已有 `maxFileBytes` 上限约束。
- **[hunk 内 context 行被整段重建，导致未修改行行尾被改写]** → 这是本次最容易漏的回归：`newLines` 同时含 context 与 added 行，直接整段替换会把 context 行也赋上主流行尾。缓解方式是按 `displayLines` 逐项重建、context 复用原对象，并专门加一条「hunk 内 context 行使用少数派行尾」的测试：原文 `keep\nold\r\nend\r\n` 应用 `old→new` 后，`keep` 的 `separator` 必须仍是 `\n`。
- **[`new_string` 本身已是 CRLF 时产出 `\r\r\n`]** → 必须先归一化再转入目标行尾。测试覆盖「`new_string` 传入 CRLF 形式的替换文本」与「归一化后 old 与 new 相同应判定为空操作」两种输入。
- **[多数派检测在首行即 CRLF、其余为 LF 的文件上可能与直觉不符]** → 采用多数派而非首行判断，避免"首行特殊"导致整体反向；测试固定该规则。
- **[`edit_file` 的 span 与最终字节长度不一致]** → span 只服务 display metadata 的行级投影，不参与写盘计算；在测试中断言 metadata 的行内容而非字节偏移。
- **[裸 CR 拒绝可能误伤含进度输出的日志类文件]** → 这类文件本来就无法用行级补丁安全编辑：读取端会把裸 `\r` 切成换行、补丁端会把它转成 `\n`，两侧行数永远无法对齐。明确拒绝优于让模型陷在"行数对不上"的隐性不匹配里。错误文本给出可执行的说明而非让他重读文件。
