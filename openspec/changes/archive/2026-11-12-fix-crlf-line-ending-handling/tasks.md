## 1. 行尾感知的切分与拼接

- [x] 1.1 在 `src/tools/apply-patch-tool-handler/simulator.ts` 引入 `ContentLine = {text, separator}`，让 `splitFileContent()` 返回 `ContentLine[]` 与主流行尾风格
- [x] 1.2 按行尾条数统计实现主流行尾检测（`CRLF` 多于独立 `LF` 时取 `CRLF`，无换行时取 `LF`），并在函数注释说明规则
- [x] 1.3 让 `joinFileContent()` 按 `line.text + line.separator` 拼接，移除独立的 `trailingNewline` 标志
- [x] 1.4 在 `splitFileContent()` 中检测 `CR`-only 文件（含 `CR` 且不含 `LF`），返回可用于向外表达的行尾不支持结果
- [x] 1.5 把 `findFirstMatch()` 的比较改为 `lines[i].text`，保持匹配顺序与游标推进不变

## 2. apply_patch 的写入与展示

- [x] 2.1 让 `applySequentialUpdateHunks()` 的区间替换按 `hunk.displayLines` 逐项重建：context 复用 `currentLines[sourceIndex]`、removed 只推进 `sourceIndex`、added 新建并赋主流行尾，避免整段替换改写 context 行行尾
- [x] 2.2 实现 `separator` 边界规则：替换区间末尾为 context 时自然保持、为 added 且在文件末尾时继承被替换区间末项、末尾纯插入处理无尾换行、纯删除到末尾时继承被删区间分隔符
- [x] 2.3 `simulateUpdateFile()` 改用 `joinFileContent()` 直接拼接，未修改行字节保持不变
- [x] 2.4 `simulateDeleteFile()` 使用 `line.text` 生成展示行，验证不再携带 `\r`
- [x] 2.5 `simulateAddFile()` 保持 `LF` 默认行尾
- [x] 2.6 在 `src/tools/apply-patch-tool-handler/tool-handler.ts` 把裸 `CR` 拒绝映射为 `ok: false` 与明确的 `reason`，且不附带要求重读文件的 `hint`

## 3. edit_file 的行尾兼容

- [x] 3.1 在 `src/tools/edit-file-tool-handler/tool-handler.ts` 增加归一化函数，同时返回 `normalized` 文本与 `offsetMap`（归一化偏移到原文偏移的映射）
- [x] 3.2 让 `simulateEdit()` 在归一化文本上定位匹配与计算非重叠区间
- [x] 3.3 让 `new_string` 先归一化行尾再转换为目标主流行尾，避免 CRLF 输入产出 `\r\r\n`
- [x] 3.4 在归一化后重新判定 `old_string` 与 `new_string` 是否相同，相同则返回「无实际变化」且不写盘
- [x] 3.5 按 span 重新拼接写回内容：未命中区间用 `content.slice()` 原样拷贝，替换区间写入第 3.3 步结果
- [x] 3.6 让 `simulateEdit()` 返回归一化后的 before/after 供 display 使用，避免归一化偏移与含 `\r` 文本错位
- [x] 3.7 对含裸 `CR` 的文件返回明确的行尾不支持原因，且不修改文件

## 4. 测试

- [x] 4.1 新增 `apply_patch` 的 `CRLF` 用例：含 context 行的 update hunk 成功应用，且写回仍为 `CRLF`
- [x] 4.2 新增同一 hunk 在 `LF` 与 `CRLF` 文件上结论一致、行内容一致的对照用例
- [x] 4.3 新增 hunk context 行保留原行尾的用例：原文 `keep\nold\r\nend\r\n` 应用 `old→new` 后，`keep` 的分隔符仍为 `\n`
- [x] 4.4 新增 `edit_file` 的 `CRLF` 用例：`LF` 形式的 `old_string` 唯一匹配成功、`replace_all` 多处替换成功，写回保持 `CRLF`
- [x] 4.5 新增混合行尾用例：未修改行逐字节保持原分隔符、新增行采用主流行尾，并断言与既有「未命中区域保持不变」一致
- [x] 4.6 新增尾换行用例：`apply_patch` 的末尾插入/替换保持原状态；`edit_file` 显式增删尾换行均生效且不被额外干预
- [x] 4.7 新增无换行文件使用 `LF` 作为默认行尾的用例
- [x] 4.8 新增 `new_string` 自带 `CRLF` 时不产出 `\r\r\n` 的用例，以及归一化后 old 与 new 相同时拒绝写入的用例
- [x] 4.9 新增含裸 `CR` 文件被 `apply_patch`（含 `Delete File`）与 `edit_file` 明确拒绝的用例，断言不写盘、不生成单行 removed 展示、提示不要求重读
- [x] 4.10 新增展示行不含 `CR`/`LF` 的断言，覆盖 `apply_patch` 的 update 与 delete 两种 metadata
- [x] 4.11 确认既有 `LF` 文件的 `apply_patch`/`edit_file` 测试全部保持通过，匹配失败场景仍返回「匹配 0 处」

## 5. 验证

- [x] 5.1 运行 `npm run typecheck`
- [x] 5.2 运行 `npm test`
- [x] 5.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.4 手动验证：用 `apply_patch` 更新一个真实 `CRLF` 文件，确认成功且 `xxd` 显示行尾仍是 `0d 0a`
- [x] 5.5 手动验证：用 `edit_file` 对同一 `CRLF` 文件做多行替换，确认写回行尾与未修改行字节不变
