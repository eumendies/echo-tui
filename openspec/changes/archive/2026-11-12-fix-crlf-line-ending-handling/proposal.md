## Why

`apply_patch` 与 `edit_file` 目前无法修改任何 CRLF 行尾的文件。三层各自"合理"的实现叠成一个死锁：

1. `read_files` 用 `readline` 的 `crlfDelay: Infinity` 读取，逐行产出时已剥掉 `\r`，模型看到的是干净内容
2. 补丁文本在解析前被 `patch.replace(/\r\n?/g, '\n')` 归一化，模型即使猜到行尾问题也无法在补丁里表达 `\r`
3. 目标文件按 `'\n'` 切分，每行尾部残留 `\r`，再与无 `\r` 的 hunk 行做精确比较

实测复现：同一份补丁在 LF 文件上成功，在内容完全相同的 CRLF 文件上返回 `hunk 1 of 1 matched 0 locations`，同时附带 `Failed hunk lines` 三行看起来完全正常。随后工具给出 `Hint: Read the file again and include more surrounding context in the hunk.`，而重读该文件返回的仍是干净内容——模型进入无法自证的死循环。

影响 Windows/WSL 项目、`.bat`/`.cmd`、`.gitattributes` 保留 CRLF 的仓库，以及任何 vendored 的 Windows 源码树。

## What Changes

- `apply_patch` 的 hunk 匹配 SHALL 在「行尾分隔符已归一化」的视图上进行，使 CRLF 与 LF 文件对同一份补丁产生一致结果
- `apply_patch` 与 `edit_file` 写回 SHALL 逐行保留未修改行的原始行尾分隔符，不把 CRLF 文件整体转成 LF
- `edit_file` 的 `old_string` 匹配 SHALL 应用同一套行尾归一化规则，`new_string` 写入时 SHALL 采用目标文件的行尾风格
- 写回 SHALL 逐行保留未修改行的原始分隔符，仅在写入新行或替换行时使用文件的主流行尾风格
- 混合行尾文件 SHALL 可编辑：未修改行保持各自原有分隔符，新增行使用主流行尾，不会因行尾混合被拒绝
- 检测到目标文件包含不构成 `CRLF` 的裸 `CR` 时，handler SHALL 返回明确的行尾不支持原因，而不是让其塌成单行后报「匹配 0 处」
- 文件编辑工具的展示行 SHALL NOT 携带行尾分隔符字符
- `read_files` SHALL 继续返回归一化后的行内容；本次不新增行尾提示字段

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-tool-execution`: 为文件编辑工具新增行尾兼容约束，细化既有「精确匹配」语义在 CRLF、LF 与混合行尾文件上的行为

## Impact

- `src/tools/apply-patch-tool-handler/simulator.ts`：切分与拼接需要携带行尾信息，匹配改用归一化视图
- `src/tools/apply-patch-tool-handler/tool-handler.ts`：新增行尾不支持错误的对外表达
- `src/tools/edit-file-tool-handler/tool-handler.ts`：`simulateEdit` 的匹配与替换需要同一套行尾处理
- `test/tools/`：新增覆盖 CRLF、LF、混合行尾与裸 `CR` 拒绝的编辑用例
- 不影响 `read_files` 的返回格式、工具定义 schema、审批流程、change history 或 `--once` 无终端路径
