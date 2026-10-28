## 1. 全局配置与运行目录

- [x] 1.1 用户全局配置写 version 3、读 version 1/2/3，按名称保存布尔启停，缺省 true；模型策略写 version 2、读 version 1/2。
- [x] 1.2 全局配置异常 fail-closed；模型策略保持既有来源优先级、整体覆盖与父策略继承规则。
- [x] 1.3 单文件原子保存、指纹保护，同文件模型策略与其他名称偏好相互保留。
- [x] 1.4 按全局启停过滤冻结目录，保留候选限额、空目录工具省略、伪造拒绝及 headless/full-access 边界。

## 2. Agent 管理

- [x] 2.1 一级详情提供全局开关、草稿标记及保存/取消；列表区分启停、定义有效性与来源覆盖。
- [x] 2.2 策略子表单独立保存，往返保留全局草稿；同文件自身策略写入正确推进指纹，项目策略保存保留全局冲突检测。
- [x] 2.3 保留内置模型策略配置、自定义定义管理、默认取消确认及简洁删除提示。
- [x] 2.4 有界诊断、无效策略入口、主工具状态与宽窄屏布局保持一致。

## 3. 文档与验收

- [x] 3.1 proposal、design、specs、配置与架构文档描述当前全局启停和模型策略。
- [x] 3.2 按顺序运行 typecheck、全套测试、JS syntax，并补录最新验证数据。
- [x] 3.3 运行 OpenSpec strict 与 diff whitespace 校验。
- [x] 3.4 记录真实 TTY 验收环境限制，按用户要求关闭待办；全局开关、保存/取消、策略子菜单、resize 与终端清理等真实 TTY 交互未完成实测。

## 验证记录

- 定向测试 164/164 通过，日志 `/tmp/echo-global-settings-targeted.log`。
- 按顺序通过 typecheck → 全套测试 → JS syntax：2357 项，2328 通过、29 跳过、0 失败，日志 `/tmp/echo-global-settings-full-test.log`。OpenSpec strict 与 `git diff --check` 通过。
- 隔离 HOME 的 `npm start` 非 TTY 烟测通过：全局开关保存、子表单往返、草稿取消、仅写全局文件、Ctrl+D 退出及无 alternate screen，日志 `/tmp/echo-global-settings-start.log`。
- 真实 TTY 分配报 `out of pty devices`，未完成实测；按用户明确要求关闭 3.4 待办并继续归档与集成。非 TTY 烟测及 controller/renderer 测试不能替代真实终端验收。
- 归档集成前再次按顺序通过 typecheck → 全套测试 → JS syntax：2357 项，2328 通过、29 跳过、0 失败，日志 `/tmp/echo-subagent-finalize-test.log`；主规格同步后 OpenSpec 全量 strict 校验 85/85 通过。
