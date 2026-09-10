## Why

连续按键(输入编辑、删除、光标移动)时,footer 每次重绘都在单次 write 内整帧擦除上一帧再整帧重写:真正变化的通常只有 composer 输入行,而 status line、composer 边框、pending 预览等未变内容也被反复 clearLine + 重写。擦除与重写之间的中间状态会被部分终端呈现,叠加每次 hideCursor/showCursor 重置光标闪烁相位,形成可感知的频闪。近期已修复"问题卡片挂起期间的周期重绘频闪",但按键路径的整帧擦写仍在,输入体验的最后一层抖动需要解决。

## What Changes

- footer renderer 在 `render()`(无 transcript 追加内容)路径引入帧级 diff + 原位覆写:与上一帧逐行比较,未变行完全跳过,变化行原位覆写(CR + 新行 + 清行尾),不再"先 clearLine 再重写"
- 帧高变化只处理增量:新帧更高时在尾部追加新行,更矮时只多清多余的行
- 光标 hide/show 最小化:帧高不变且仅少量行变化时不再包 hideCursor/showCursor;帧高变化或整帧重绘路径仍保留
- `append(content)`(transcript 追加)路径保持现有整帧重绘不变(footer 起始位置已变,行级 diff 无意义)
- 渲染仍保持单次 write() 批量输出;`FooterRenderer` 对外接口不变,BTW 等其它 projection owner 路径自动受益

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `terminal-tui-prototype`:footer 局部重绘策略从"未变行整帧擦写"改为"帧级 diff + 原位覆写 + 高度增量处理";"footer 重绘和光标恢复"要求中 hide cursor 的适用范围收紧为帧高变化或多行重写场景

## Impact

- 代码:`src/render/footer.ts`(DefaultFooterRenderer 内部:新增上一帧行数组记忆、diff 序列构造、光标 hide/show 最小化);`FooterRenderer` 对外接口不变
- 测试:新增 `test/render/footer-diff.test.js`(fake output 断言增量序列与未变行不被擦写);既有 `test/render/footer.test.js` 回归
- 行为风险:diff 记忆与终端实际状态失配(如外部程序改动终端)——以"帧高变化回退整帧重绘"与现有 destructive resize recovery 兜底
