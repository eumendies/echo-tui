# 用户手动验证清单

以下交互验证需由用户在真实终端中执行。

## `/skills` 宽终端

- [ ] 运行 `npm start`，打开 `/skills`，确认默认活动字段为“模型”。
- [ ] 使用 Up/Down 切换 skill，确认选中行、启停状态、模型和 effort 同时可见。
- [ ] 使用 Left/Right 切换模型，确认 effort 草稿不变。
- [ ] 使用 Tab/Shift+Tab 在模型与 effort 字段间切换，确认活动字段高亮和底部提示同步变化。
- [ ] 在 effort 字段使用 Left/Right，确认候选按“模型默认、none、minimal、low、medium、high、xhigh”循环，且模型草稿不变。
- [ ] 按 Space 修改启停状态后按 Esc，重新打开 `/skills`，确认所有草稿均未保存。
- [ ] 再次修改模型、effort 和启停状态后按 Enter，确认 surface 关闭且没有触发 agent 请求。

## `/skills` 窄终端与持久化

- [ ] 将终端缩窄到约 44 列，确认行宽不溢出，选中 skill 的启停状态、名称和活动字段仍可识别。
- [ ] 确认宽度不足时 description 和非活动策略优先被裁剪。
- [ ] 检查对应项目级或用户级 skill root 的 `skills.json`，确认写入 `schemaVersion: 3` 和按名称排序的 `effortOverrides`。
- [ ] 将 effort 设为“模型默认”并保存，确认对应 skill 不出现在 `effortOverrides`；设为 `none` 并保存，确认显式写入 `"none"`。

## Direct slash invocation

- [ ] 为一个 skill 固定 model 和 effort 后执行 `/<skill-name>`，确认只出现一条本地 override notice。
- [ ] 响应期间确认 status line 显示实际模型、指定 effort 和 `SKILL override`；响应完成后恢复全局模型与 effort。
- [ ] 将该 skill 模型设为“当前模型”、effort 设为固定值后再次调用，确认仅 effort 被覆盖。
- [ ] 临时让 skill 引用已删除 model profile，同时保留固定 effort，确认模型回退全局当前 profile、effort 仍生效。
- [ ] 在普通 turn 中让模型自主调用 `use_skill`，确认不会切换到该 skill 的 model 或 effort 策略。
