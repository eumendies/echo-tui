## Why

当前未知 bash 在启动前使整轮 checkpoint 失效，并清空更早历史，导致测试、脚本等命令频繁误伤 `/undo`。先提供范围明确的受控文件恢复，提高可用性，以逐文件指纹判断是否可以继续回退更早历史。

## What Changes

- 未知前台 bash 标记本轮存在未追踪操作，不中止受控文件记录；未知后台命令成功启动或 spawn 后取消时同样标记，但活动写任务继续阻止恢复。
- `/undo` 明确提示仅恢复记录中的文件，shell 其他影响保留；成功后保留较早 checkpoint 并传递独立的风险元数据和一次性提醒，新轮不继承展示提示，继续按各轮文件指纹回退。
- 保存受控编辑后的文件指纹，恢复前统一核验，冲突时不恢复文件或截断记录。
- 保存原始基线指纹和无损字节快照，保持已有符号链接编辑能力并检测换链；后台失败按实际 PID 记录执行事实，真实退出前不释放写保护。
- 保持旧 invalid checkpoint、快照失败和活动后台写任务的安全保护；缺少指纹的历史记录在存在未追踪影响时拒绝恢复，其余沿用提示后的兼容恢复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `undo-command`: 增加有限恢复、跨未追踪操作的逐轮回退和恢复前文件冲突检查。

## Impact

影响 change history 类型与上下文、bash 执行入口、undo 确认界面、AppContext/transcript 回退事务及 session journal。复用现有 ANSI command surface，不引入 Git、工作区扫描或新依赖。
