## REMOVED Requirements

### Requirement: Memory tool semantic and result projection
**Reason**: `add_memory`、`read_memory`、`update_memory` 和 `remove_memory` 不再是 provider-visible tools，memory 操作改为 `use_skill` 后执行普通 bash 脚本。

**Migration**: Skill 加载继续使用现有 `use_skill` 投影，脚本命令及结果继续使用现有 bash rail 投影；不再显示 Remembering、Recalling、Revising 或 Forgetting 专属摘要。

### Requirement: Memory renderer safety and record preservation
**Reason**: 专属 memory renderer 随旧 memory tools 一并删除，不再需要单独维护其解析和安全降级规则。

**Migration**: 新产生的 memory skill 记录由 `use_skill` 和 bash renderer 处理；恢复出的旧 memory tool records 使用通用 tool renderer 安全显示。
