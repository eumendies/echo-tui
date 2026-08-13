## MODIFIED Requirements

### Requirement: Subagent 投影按实际 Agent 身份显示
Subagent rail、footer pending、用户问题surface、审批surface和外层`run_subagent`紧凑结果 SHALL使用当前run的受信任`agentName`或外层调用中通过安全格式校验的`agent`参数投影身份。合法自定义名称 SHALL获得有界、无控制字符的可读通用标题和完成状态；内置Explorer与Worker MAY保留既有专属成功文案。通用工具显示名 SHALL NOT把`run_subagent`固定命名为任一具体Agent；无法安全解析Agent名称时 SHALL使用通用`Run subagent`或`Subagent`回退。

#### Scenario: Worker 状态使用 Worker 身份
- **WHEN** Worker运行产生start、内部工具、用户问题、审批和completed事件
- **THEN** 对应rail、footer和modal标题 SHALL显示Worker身份
- **THEN** 外层成功pair SHALL显示Worker完成任务的紧凑状态且不重复最终正文

#### Scenario: Explorer 投影不回归
- **WHEN** Explorer运行完成
- **THEN** rail和外层紧凑pair SHALL继续显示Explorer身份
- **THEN** renderer SHALL NOT因支持自定义名称而改变Explorer内部工具的muted tone和宽度规则

#### Scenario: 自定义 Agent 使用自身身份
- **WHEN** 合法自定义`security-reviewer`运行并产生过程、交互与终态
- **THEN** rail、footer、审批或提问surface SHALL显示对应自定义身份而不是Explorer、Worker或无差别Subagent标题
- **THEN** 外层紧凑pair SHALL显示该自定义Agent已完成且不重复最终正文

#### Scenario: 不安全名称使用通用回退
- **WHEN** renderer重放旧记录或损坏参数且Agent名称包含控制字符、超过上限或不符合稳定名称规则
- **THEN** renderer SHALL使用通用Subagent身份并保持终端行宽安全
- **THEN** 未校验名称 SHALL NOT原样进入ANSI输出、surface标题或状态行
