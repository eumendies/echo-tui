## Context

footer 当前重绘策略(`src/render/footer.ts` 的 `DefaultFooterRenderer`)是:在单次 write 内先按上一帧高度逐行 clearLine 擦除旧帧,再整帧重写所有行,最后定位光标。该策略对 `render()`(无 transcript 追加)与 `append(content)`(transcript 追加)两条路径行为一致。

按键、status line spinner、pending draft 更新等普通交互每秒触发约 10 次以上 footer 重绘,而其中真正变化的通常只有 composer 输入行:status line、composer 边框、pending 预览等未变行被反复擦写,擦与写之间的中间状态会被部分终端呈现,叠加每次 hideCursor/showCursor 重置光标闪烁相位,形成可感知频闪。相关现状需求见 `terminal-tui-prototype` 的"普通交互只重绘 footer"、"footer 重绘和光标恢复"与"transcript 追加前清理临时 footer"。

## Goals / Non-Goals

**Goals:**

- `render()` 路径只重写内容发生变化的行,未变行完全不触碰终端
- 帧高变化只处理增量(追加新行 / 多清多余行),不整帧位移
- 光标 hide/show 最小化,减少光标闪烁相位重置
- 保持单次 write() 批量输出,不增加 write syscall 次数
- `FooterRenderer` 对外接口不变,BTW 等其它 projection owner 自动受益

**Non-Goals:**

- 不做字符级/区域级 diff(行是终端最小重绘单元,更细粒度收益趋零)
- 不改变 `append(content)`(transcript 追加)的整帧重绘策略(footer 起始位置已变,diff 无意义)
- 不引入 ANSI 解析器;不做滚动区域(scroll region)等更激进的终端优化
- 不改变 resize/destructive recovery 行为

## Decisions

1. **diff 粒度 = 最终行字符串的字节级比较(含 ANSI)**。同一输入状态下相同行的渲染字节必然一致,直接字符串相等比较即可:零解析成本、不会误判。备选的"剥离 ANSI 后比较"或"按列 diff"都需要解析,复杂度不换收益。
2. **记忆载体:在现有 `rememberLayout` 基础上追加 `previousLines: string[]`**。现有 `previousHeight`/`previousCursorRow` 语义保持不变,`previousLines` 必须存 `renderFooterLayout` 输出的最终形态(经 `constrainLayoutTail` 之后),保证 diff 基准与终端实际写入的行一一对应。
3. **路径分流:`append(content)` 中 `content === ''` 走 diff 路径,否则走现有整帧路径**。`render()` 即 `append('', state)`,零额外入口。整帧路径完成后照旧 `rememberLayout` 更新记忆,后续 diff 基于新帧。
4. **原位覆写序列 = `CR` + 新行内容 + `EL`(clearEndOfLine,清行尾)**。不整行 clearLine 先擦后写,而是先写新内容再清掉行尾残余:内容从头到尾连续出现,不存在"整行为空"的中间帧。EL 为 ECMA-48 基础序列,支持面与现有 clearLine(EL2)同级。
5. **hide/show 最小化规则:帧高变化或重写行数 > 1 时包 hideCursor/showCursor;单行原位覆写不包**。单行覆写序列长度在一行以内、原子性足够,不包 hide 可避免每次按键重置光标闪烁相位;若实测有可感知的光标跳动,回退为总是 hide(一个布尔开关)。
6. **未变行跳过的定位方式:沿用 `cursorUp`/`CR` 组合,先回到上一帧顶部,再逐行扫描**,相同行仅 `cursorDown(1)`,变化行覆写后 `cursorDown(1)`,帧尾多余旧行 `clearLine` 清除。与现有 `createClearPreviousSequence` 的锚定方式一致,不引入新的光标状态。
7. **失配兜底:diff 记忆只在"自上次 footer 写入以来终端未被外部改动"的前提下有效**。破坏性路径(`renderDestructive`、`clear`、退出)本来就重置或重绘全部状态;resize 走既有 destructive recovery;若实测出现失配花屏,整体回退开关 = 恢复整帧重绘(git revert 即可)。

## Risks / Trade-offs

- [终端对 EL(K) 支持差异] → EL 是 ECMA-48 基础序列,主流终端一致支持;风险等同现有 clearLine
- [diff 记忆与终端实际失配造成残留] → 帧高变化回退整帧处理;破坏性路径重置记忆;resize 走 destructive recovery;测试锁定增量序列
- [单行覆写不 hide cursor 期间光标可见移动] → 序列执行在微秒级,理论不可感知;保留"总是 hide"回退开关
- [字节级比较对 ANSI 样式变化敏感] → 样式变化即内容变化,重写是正确行为;不存在"样式变了但视觉没变"的误判方向

## Migration Plan

无部署迁移:纯渲染行为变化,默认随版本发布。回滚 = revert footer.ts 相关提交即可恢复整帧擦写。验证顺序:先跑新增 fake-output 测试与既有 footer 测试,再人工验证连续输入/换行/slash 建议/@选择器/流式并行输入。
