## 1. 测试基建与基线

- [x] 1.1 新建 `test/render/footer-diff.test.js`:fake output 捕获 write 序列,提供 renderFooterLayout 状态构造助手(composer/status line/建议列表组合)
- [x] 1.2 记录现状基线:连续两次 `render()`(仅 composer 输入行变化)的现有整帧擦写序列快照,作为行为对照

## 2. footer 增量重绘实现

- [x] 2.1 `DefaultFooterRenderer` 新增 `previousLines` 记忆:`rememberLayout` 同步存储 `renderFooterLayout` 输出的最终行数组(经 constrainLayoutTail 之后)
- [x] 2.2 实现行级 diff 序列构造:未变行仅光标下移跳过;变化行原位覆写(`CR` + 新行内容 + `EL` 清行尾);不引入 ANSI 解析
- [x] 2.3 帧高增量处理:新帧更高时在尾部追加新行,更矮时只清理底部多余行;统一并入单次输出序列
- [x] 2.4 路径分流:`append(content)` 中 `content === ''` 走 diff 路径,非空保持现有整帧重绘;整帧路径完成后照常更新记忆
- [x] 2.5 光标 hide/show 最小化:仅整帧重绘或帧高变化时输出 hideCursor/showCursor 包裹;帧高不变的单行原位覆写不包,且覆写后光标仍定位到 composer 逻辑位置
- [x] 2.6 记忆重置一致性:`clear()`/`renderDestructive()` 后增量记忆与现有 `previousHeight`/`previousCursorRow` 一同重置,防止跨破坏性状态的错位 diff
- [x] 2.7 SGR 状态隔离:每个重写行/增高行/清理行写入前先 `SGR reset`,整帧清理序列起始复位;防止继承 transcript 或相邻行遗留背景后被 EL/EL2 按 BCE 画出色块(实测 slash 建议场景复现的错位根因)
- [x] 2.8 帧增高用 LF 下移:帧底贴住屏幕最后一行时 `cursorDown` 被终端钳制,新行全部叠印在底行、光标收位落到帧外上方,后续按键从错误光标位 diff 造成全帧错位;增高行改用 `\n`(LF),底行触发终端滚动腾行,与整帧路径 `'\n'` 连接行为一致(实测 transcript 灌满后的 slash 场景复现并修复)

## 3. 测试

- [x] 3.1 未变行不触碰:两次 `render()` 仅 composer 行变化,第二次 write 序列中 status line、composer 边框、pending 行无 clearLine 且无重写
- [x] 3.2 变化行原位覆写:序列为 `CR` + 新行 + `EL`,且不再出现对变化行的先清后写
- [x] 3.3 帧高增量:composer 换行(增高)只追加新行;slash 建议消失(降低)只清理底部多余行
- [x] 3.4 单次批量输出:每次 `render()` 恰好一次 `output.write`
- [x] 3.5 transcript 追加回归:`append(非空 content)` 仍整帧重绘,行为与现状一致
- [x] 3.6 光标语义:覆写后光标位于 composer 逻辑位置;hideCursor/showCursor 仅按 2.5 规则出现
- [x] 3.7 回归:既有 `test/render/footer.test.js`、`test/render/app-renderer.test.js` 与全量测试零失败
- [x] 3.8 SGR 隔离测试:变化行以 `reset + CR` 开头,增高/降低行与整帧清理序列携带 `reset`;并用 ANSI 模拟器(含 BCE/pending-wrap)对真实 app 全链路逐帧校验 slash 场景(80/247 列、脏 SGR 注入)
- [x] 3.9 贴底增高测试:增高行以 `\n` + `reset` 下移而非 `cursorDown`;复现脚本在灌满 transcript(帧底贴屏幕最后一行)后校验 slash 展开逐帧帧内容、残留与光标终位(ROWS=14/16/30、流式并行、80/247 列全过)

## 4. 验证与收尾

- [x] 4.1 完整验证序列:`npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;` 全过
- [x] 4.2 手动验证:连续英文/CJK 输入、Ctrl+J 换行、slash 建议逐字变化、@文件选择器、流式响应并行输入均无可感知频闪(用户已确认;并复验 slash 建议贴底展开与审批/提问/@选择器/子 agent 全链路)
- [x] 4.3 若实测单行覆写期间光标可见跳动,启用"总是 hide"回退开关并在 design 记录(条件未触发:实测无可见光标跳动,回退开关未启用)
- [ ] 4.4 经用户确认后提交 dev;archive 时同步 delta 到主 spec(`openspec/specs/terminal-tui-prototype/spec.md`)
