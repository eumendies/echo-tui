## 1. 建立轻量 Session Index

- [x] 1.1 在 transcript 类型中定义 schemaVersion 1 的项目级 session index、含标题的 `TranscriptSessionSummary`、journal 指纹和 `TranscriptSessionPreview`，并删除会强制预加载预览的旧 metadata 类型
- [x] 1.2 在 transcript store 中实现 `sessions/index.json` 的路径解析、schema 校验、读取和临时文件原子替换
- [x] 1.3 实现 index 与 `.jsonl` 目录的 size/mtime 对账，以及缺失、损坏、孤立和单项过期时的 journal 重建逻辑
- [x] 1.4 为有效 index 快路径增加测试，验证列表排序、空目录处理和指纹匹配时不会读取 journal 正文
- [x] 1.5 为 index 缺失、损坏、单项过期、孤立条目和无效 journal 增加持久化测试

## 2. 在 Journal 写入路径维护 Index

- [x] 2.1 让 TranscriptContext 在 session 创建、records/state 追加、truncate 和 fork 成功后，从当前最终 records 与 journal reference 生成轻量列表摘要
- [x] 2.2 在 journal 成功落盘后 best-effort 更新对应 index entry，并保证 index 写入失败不回滚或破坏 journal
- [x] 2.3 增加创建、普通追加、仅状态更新、truncate、fork 和 index 写入失败测试，验证 messageCount、updatedAt 与 journal 指纹正确

## 3. 拆分历史会话列表与预览读取

- [x] 3.1 为 TranscriptStore、TranscriptContext 和 CommandHost transcript/reference ports 增加共享 `listSessionSummaries()` 查询，让 `/resume` 与 `/reference` 都使用轻量 index
- [x] 3.2 实现单 session 的异步只读预览加载，基于最终 replay 状态返回最近 20 条有界 preview records，且不修复源 journal 或修改当前 transcript
- [x] 3.3 在 TranscriptContext 中实现最多 5 项、按 cwd、sessionId 与 journal 指纹键控的共享预览 LRU，并测试跨入口缓存命中、淘汰、fingerprint 失效和 cwd 隔离

## 4. 改造历史会话 Surface 生命周期

- [x] 4.1 调整 session browser 和 command surface 类型，使 `/resume` 与 `/reference` 列表项都不再内嵌 previewRecords，并统一支持右栏 loading、ready 和 error 状态
- [x] 4.2 更新 resume renderer，在列表首帧、加载中、加载失败和有预览记录时输出稳定双栏布局，并移除固定 118 列上限，宽终端按 file picker 策略保留 4 列边距
- [x] 4.3 改造 ResumeCommandHandler 与 ReferenceCommandHandler：先同步打开 index 列表 surface，再调度首个选中项异步预览，并在选择改变时立即更新左栏
- [x] 4.4 将分页、焦点、滚动和 loading 状态放入 `commands/session/session-browser.ts`，将 120ms 防抖、generation、active command/sessionId 校验和错误投影放入共享 preview controller
- [x] 4.5 保持 Resume Enter 通过正式 `loadSession()` 完整恢复，Reference Enter 通过完整只读 replay 创建 pending 引用，并确保 Esc、Enter 或重新打开命令后旧预览结果不能更新 surface

## 5. 集成测试与验证

- [x] 5.1 更新 slash command/controller 测试，覆盖 `/resume` 与 `/reference` 首帧不等待预览、连续移动只加载最终项、乱序完成、失败反馈和关闭后迟到隔离
- [x] 5.2 更新 footer renderer 测试，覆盖三种预览状态、窄终端、滚动预览、列表分页和宽终端接近占满安全宽度
- [x] 5.3 增加集成回归测试，验证 `/reference` 候选标题、按需预览与完整引用准备，截断后消息数量/预览，以及实际 session 恢复内容不变
- [x] 5.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 5.5 记录需由用户手动验证的交互项：大量历史会话下 `/resume` 与 `/reference` 首帧、快速方向键导航、预览 loading/error、宽终端布局、Enter 确认和 Esc 关闭
