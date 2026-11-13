## 1. 输入事件与解析

- [x] 1.1 在 `src/input/event-types.ts` 新增 `MOVE_PREVIOUS_WORD`、`MOVE_NEXT_WORD`、`DELETE_NEXT_WORD` 三个语义事件
- [x] 1.2 调整 `src/input/key-parser.ts` 中 `parseKeyChunk()` 的匹配顺序，把 `findSequenceAt()` 提到 `parseTerminalReportAt()` 之前，并在函数注释说明理由
- [x] 1.3 在 `KEY_SEQUENCES` 注册 `ESC[1;5D`、`ESC[1;3D`、`ESC[1;5C`、`ESC[1;3C`、`ESC[3;5~`、`ESC[3;3~` 六个序列，按现有风格标注注释
- [x] 1.4 在 `test/input/key-parser.test.js` 增加词级序列解析用例，覆盖六个序列映射到三个事件
- [x] 1.5 在 `test/input/key-parser.test.js` 增加反向断言：完整 CPR `ESC[12;40R` 仍产生 `cursor_position`；未注册 CSI（如 `ESC[1;9D`）仍不产生事件且不插入文本；普通 `ESC[3~` 仍产生 `delete_forward`
- [x] 1.6 在 `KEY_SEQUENCES` 注册 `ESC b`、`ESC f`、`ESC d`、`ESC <DEL>` 四个 ESC 前缀序列，覆盖 iTerm2 与 Terminal.app 对 Option+方向键的默认映射
- [x] 1.7 在 `test/input/key-parser.test.js` 增加 ESC 前缀用例：四个序列的事件映射；确认不再产生 `escape` 或把字母当文本插入；未注册前缀（`ESC a`）与 `ESC[A` 行为不变；`createKeyParser` 拆包时合并为单个事件；落单 ESC 经 `flushPendingEscape()` 仍产生 `escape`

## 2. composer 词级编辑

- [x] 2.1 在 `src/input/composer.ts` 抽出内部词边界函数，分别计算光标前一个词的起点与光标后一个词的终点，并让既有 `deletePreviousWord()` 复用，保持切词行为完全不变
- [x] 2.2 新增 `movePreviousWord()` 与 `moveNextWord()`，只修改 `cursor`，并限制在内容边界内
- [x] 2.3 新增 `deleteNextWord()`，通过 `replaceRange()` 删除区间，使 `fileMentions` 坐标按既有规则重映射
- [x] 2.4 在 `applyComposerEditEvent()` 接入三个新事件的分发
- [x] 2.5 在 `test/input/composer.test.js` 增加移动与删除用例，覆盖词首/词尾边界、连续空白、开头与结尾不越界
- [x] 2.6 在 `test/input/composer-file-mentions.test.js` 把新函数纳入既有引用一致性断言，覆盖按词删除跨引用区间时引用被撤销

## 3. 界面文案与文档

- [x] 3.1 更新 `src/commands/help-command-handler.ts` 的 `HELP_SURFACE` 编辑行，加入按词移动与按词删除说明
- [x] 3.2 更新 `README.md` 的「常用按键」表，加入对应条目
- [x] 3.3 在 `README.md` 补充 macOS 修饰键说明：Option 即 Alt，Command 默认被终端占用

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`
- [x] 4.2 运行 `npm test`
- [x] 4.3 运行 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 4.4 手动验证：`npm start` 后在多行英文与中文草稿上按 `Ctrl+←/→` 与 `Alt+←/→` 验证按词移动，按 `Ctrl+Delete` 与 `Alt+Delete` 验证按词删除，并确认普通方向键、`Delete`、`Ctrl+W`、`Ctrl+A/E/U/K` 行为不变
- [x] 4.5 手动验证：确认文件引用（`@` 选择确认）后再按词删除跨引用区间时引用被撤销，其余引用仍高亮正确
- [x] 4.6 手动验证 macOS 的 `Option+←/→`、`Option+D`、`Option+⌫` 在 iTerm2 与 Terminal.app 下的实际行为，确认不再插入 `b`/`f`/`d` 字符、不再触发中断；`Option+⌫` 应删除前一个词而不是删除一个字符
