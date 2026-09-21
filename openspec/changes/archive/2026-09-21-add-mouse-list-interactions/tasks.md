## 1. 终端鼠标能力与输入协议

- [x] 1.1 在 ANSI/terminal 层实现 SGR 鼠标模式与 cursor position query 的启用、禁用和幂等清理，并限定为交互 TTY。
- [x] 1.2 将状态化 key parser 扩展为可跨 chunk 解析 SGR 鼠标报告和受控 CPR 回复，且保持 bracketed paste 语义不变。
- [x] 1.3 扩展输入事件类型，表达经校验的鼠标阶段、按键、修饰键、屏幕坐标与内部位置定位结果。
- [x] 1.4 为鼠标模式生命周期、分 chunk 报告、无效/未知报告不污染 composer、CPR 匹配与非 TTY 降级添加单元测试。

## 2. Footer 命中与坐标校准基础设施

- [x] 2.1 扩展 footer layout/render 结果，定义带 render version、owner、可见矩形和结构化 target 的 transient hit map。
- [x] 2.2 在 footer 实际绘制、增量重绘、清理和 destructive resize recovery 后维护 hit map 的有效性与 render version。
- [x] 2.3 实现与当前 footer layout 绑定的终端位置校准、超时/失配失效和屏幕坐标到 footer 相对坐标的转换。
- [x] 2.4 在 InputEventController 前置命中测试与 owner 路由，忽略过期、未校准、空白、非左键及非当前 owner 的鼠标事件。
- [x] 2.5 对同一 hover target 做去重，验证不重复 render，且 hover 不触发提交、审批、mention 插入或 transcript 写入。
- [x] 2.6 为 hit map 裁剪、版本失效、坐标转换、resize 与校准失败降级添加 renderer/controller 级测试。

## 3. 第一阶段列表 renderer 命中区域

- [x] 3.1 为 slash suggestion renderer 的当前可见建议项登记绝对建议索引命中区域，并排除 `more` 行。
- [x] 3.2 为 choice surface 的当前可见 tabs、普通 options 与 inline input options 登记 target 类型和绝对索引，并保持高度裁剪后的坐标正确。
- [x] 3.3 为 file picker 左栏的当前可见目录、可选择文件与不可选择文件登记 entry 命中区域，并排除右栏 preview 与空白行。
- [x] 3.4 为窄宽度、受限高度、窗口化及含内联输入的三类 renderer 添加 hit map 覆盖测试。

## 4. 业务语义接入

- [x] 4.1 为 slash suggestion context/app context 增加按索引聚焦与鼠标补全入口；点击只补全并追加空格，不提交命令。
- [x] 4.2 为 UserQuestionContext 接入 hover 焦点、单选确认、多选切换与 Other 输入聚焦语义。
- [x] 4.3 为 ToolApprovalContext 接入 hover 焦点、action 确认与 feedback 输入聚焦语义，确保空反馈不会被点击确认。
- [x] 4.4 为 FilePickerContext 接入左栏 hover、目录点击进入、可选文件点击切换和不可选文件反馈，保持 Enter 作为唯一 mention 插入确认。
- [x] 4.5 对四类 surface 的鼠标语义、原有键盘等价行为、modal 优先级与安全边界添加 controller/context 测试。

## 5. 集成验证与文档

- [x] 5.1 更新相关 footer 操作提示，使支持鼠标的列表清楚表达 hover/click 与既有键盘操作并存。
- [x] 5.2 当前环境未执行 xterm 手工验证；用户确认豁免为本次归档前置条件，发布前仍应验证 slash、用户问题、审批和 file picker 的 hover/click、Esc、resize 与退出清理。
- [x] 5.3 当前环境未执行 tmux/ssh 手工验证；用户确认豁免为本次归档前置条件，发布前仍应验证 CPR 降级、键盘路径和 composer 不受污染。
- [x] 5.4 运行 `npm run typecheck`、`npm test` 与 `find bin src test scripts -name '*.js' -exec node --check {} \;`，修复新增测试或类型问题。

## 6. 审查整改

- [x] 6.1 仅为第一阶段实际接收鼠标语义的 surface 启用鼠标报告，并将 file picker 命中范围限制到左栏。
- [x] 6.2 收紧 hover 事件按键过滤，拒绝中键、右键和修饰键拖动。
- [x] 6.3 将 CPR 校准与 footer 实际物理位置变化绑定，串行处理定位请求并拒绝迟到回复。
- [x] 6.4 丢弃超长或无效的 SGR/CPR 控制序列，确保不会降级为 composer 输入。
- [x] 6.5 移除未参与路由的命中元数据，并覆盖审查修复的单元测试与完整自动验证。
