## ADDED Requirements

### Requirement: Inline math terminal projection
系统 SHALL 为 assistant Markdown 普通文本中的行内数学提供 Unicode 近似投影。识别范围为同一行内闭合的 `$...$` 与 `\(...\)`；表达式被确认为受支持子集时，render 层 SHALL 把其转换为携带当前 render theme `math` token 样式的 Unicode 近似文本并并入既有 inline span、样式合并与换行管线。转换 SHALL 只影响终端可见投影；transcript 原文、持久化与 provider 输入 SHALL 保持不变。`$$...$$` 与 `\[...\]` display 公式 SHALL 保持原文显示。

#### Scenario: 转换受支持的行内数学
- **WHEN** assistant Markdown 包含 `$\alpha^2 + \beta_{10}$`
- **THEN** render 层 SHALL 显示 `α² + β₁₀`
- **THEN** transcript record SHALL 保留原始 `$...$` 文本

#### Scenario: 转换 \(...\) 形式的行内数学
- **WHEN** assistant Markdown 包含 `\(\alpha^2\)`
- **THEN** render 层 SHALL 显示 `α²`

#### Scenario: 不支持表达式整体回退
- **WHEN** 行内数学包含超出子集的命令或结构（如 `\unknown{x}`、`\frac{a}{b}^2`）
- **THEN** render 层 SHALL 原样显示该表达式（含定界符）
- **THEN** render 层 SHALL NOT 输出部分转换的结果

#### Scenario: display 公式保持原文
- **WHEN** assistant Markdown 包含 `$$E = mc^2$$` 或 `\[ y = x \]`
- **THEN** render 层 SHALL 保持这些文本原样显示
- **THEN** 渲染 SHALL NOT 抛出错误

### Requirement: Inline math recognition boundaries
系统 SHALL 只在高置信度场景下识别行内数学。以下场景 SHALL 按普通文本处理、不做转换：被转义的 `\$`；`$` 后紧随空白、`(` 或 `{`；closer 后紧邻 ASCII 字母或数字；内容为纯数字且无运算符；内容为全大写单词；内容包含反引号；未在同一行内闭合；长度超出实现预算。inline code、fenced code block 与链接内部 SHALL NOT 执行数学转换。

#### Scenario: 货币金额不转换
- **WHEN** 普通文本包含 `Costs $5 and $10.`
- **THEN** render 层 SHALL 原样显示 `$5` 与 `$10`
- **THEN** 渲染 SHALL NOT 把价格区间识别为数学表达式

#### Scenario: shell 变量与命令替换不转换
- **WHEN** 普通文本包含 `$HOME`、`${HOME}` 或 `$(echo x)`
- **THEN** render 层 SHALL 原样显示这些片段

#### Scenario: 转义美元符号不参与配对
- **WHEN** 普通文本包含 `\$5.00 and $\alpha$`
- **THEN** `\$` SHALL NOT 作为数学 opener 或 closer
- **THEN** render 层 SHALL 把 `$\alpha$` 显示为 `α`

#### Scenario: 全大写单词与纯数字内容不转换
- **WHEN** 普通文本包含 `$USD$` 或 `$42$`
- **THEN** render 层 SHALL 保持原文显示

#### Scenario: inline code 与链接内部不转换
- **WHEN** inline code 包含 `$\alpha$`，或链接文本或目标包含 `$...$` 内容
- **THEN** render 层 SHALL 按 inline code 或链接的既有语义显示，不执行数学转换

#### Scenario: 数学范围与链接或 inline code 重叠时保护既有结构
- **WHEN** 行内数学候选的定界范围与链接或 inline code 候选重叠（如 closer 落在链接文本内）
- **THEN** render 层 SHALL 放弃该数学转换，保持链接或 inline code 的完整投影
- **THEN** 被放弃的 `$` 与 `\` 字符 SHALL 按普通文本显示

#### Scenario: 未闭合或超长表达式保持字面
- **WHEN** 行内 `$` 未在同一行闭合，或表达式长度超出实现预算
- **THEN** render 层 SHALL 保持原文显示
- **THEN** 渲染 SHALL NOT 抛出错误或吞掉后续文本

### Requirement: Inline math projection safety and stability
转换输出 SHALL 参与既有 display-width 换行与 ANSI 闭合规则：每个渲染行 SHALL NOT 超过当前 safe render width，换行 SHALL 落在 grapheme 边界；转换 SHALL 只使用宽度口径已覆盖的字符（EAW Ambiguous 按 1 列、组合符按 0 列），SHALL NOT 引入宽度错位。streaming 期间，未闭合的行内数学 SHALL 保持字面显示，闭合后 SHALL 在后续重渲染中完成转换；已经确定到终端历史区的行 SHALL NOT 被改写。table cell 中的行内数学 SHALL 与普通段落使用同一转换规则，且 SHALL NOT 破坏列宽对齐。

#### Scenario: 转换文本遵守宽度与换行约束
- **WHEN** 含行内数学的文本在窄宽度下渲染
- **THEN** 每个输出行的 display width SHALL NOT 超过 safe render width
- **THEN** 换行 SHALL NOT 拆分 grapheme cluster

#### Scenario: streaming 行内数学的转换时机
- **WHEN** streaming 过程中当前行包含尚未闭合的 `$...`
- **THEN** render 层 SHALL 保持字面显示
- **WHEN** 同一行后续 chunk 补全闭合的表达式
- **THEN** render 层 SHALL 在重渲染的可见投影中显示转换结果
- **THEN** 已确定到终端历史区的行 SHALL 保持不变

#### Scenario: table cell 中的行内数学
- **WHEN** pipe table 单元格包含受支持的行内数学
- **THEN** cell SHALL 显示转换结果
- **THEN** 列宽与分隔线对齐 SHALL 基于转换后的可见文本计算

#### Scenario: 转换 span 使用 math token 且不泄漏样式
- **WHEN** 行内数学与 bold、italic 或 link 等相邻 span 共存
- **THEN** 数学转换结果 SHALL 使用当前 render theme 的 `math` token 样式
- **THEN** `math` 样式 SHALL 在转换 span 结束处闭合，SHALL NOT 泄漏到相邻 span 或后续文本
- **THEN** 回退为原文的表达式 SHALL NOT 携带 `math` 样式

#### Scenario: math 颜色跟随当前 render theme
- **WHEN** 行内数学被成功转换
- **THEN** 转换结果 SHALL 使用当前 render theme 的 `math` token 颜色渲染
- **WHEN** 用户级 `theme.json` 覆盖 `markdown.styles.math`
- **THEN** 转换结果 SHALL 使用覆盖后的颜色渲染
