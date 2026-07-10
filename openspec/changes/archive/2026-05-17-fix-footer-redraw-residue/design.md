## Context

当前实现把 banner、transcript 和 footer 组合成一整块 app-owned region；在普通输入、spinner 和 pending 更新时，会先清理上一帧区域，再把整块快照重新输出。这个策略在“当前可见屏幕”内看似成立，但它并不会回收已经进入 scrollback 的旧输出，因此用户向上翻时会看到重复 banner 和旧快照残留。

历史实现里曾有独立的 footer renderer：banner 启动时只写一次，transcript 只在提交完成时 append，普通编辑只重绘 footer。当前 bug 说明 normal path 需要恢复到这种职责分离，而 resize 场景仍然必须保留 destructive recovery，因为列宽变化后旧 transcript 的物理折行已不可信。

## Goals / Non-Goals

**Goals:**
- 恢复普通交互路径的 footer-only redraw，避免 banner 和 transcript 在 scrollback 中重复累积。
- 保持 transcript records append-only；用户提交和 assistant 完成时只追加新的 transcript block。
- 保留 resize 时的 destructive full replay，使当前宽度下的布局可以从 records 正确重建。
- 让测试能区分 normal redraw、transcript append 和 resize replay 三类渲染路径，防止残留问题回归。

**Non-Goals:**
- 不改变 banner 的视觉样式、composer 编辑语义或 mock assistant 生命周期。
- 不尝试在 normal path 中局部清理 transcript；历史 transcript 仍按 append-only 处理。
- 不引入 alternate screen、第三方 TUI 库或新的终端依赖。

## Decisions

### Decision: 普通更新恢复为 footer-only redraw
普通输入编辑、光标移动、spinner thinking 和 pending draft 更新时，只调用 footer renderer，不再触发整块 app snapshot 的 clear + replay。

选择这个方案而不是继续修补 `renderNormal` 的原因：scrollback 是终端历史，不属于当前可见区域。只要 normal path 继续重发 banner 和 transcript，就一定会在 scrollback 中留下旧帧；改进 `clearPrevious` 的物理行估算并不能解决这个语义冲突。

备选方案：继续保留 full-region redraw，只优化 clear 算法。放弃原因是它只能改善“当前可见区域”的擦除精度，无法阻止历史输出被重复写入 scrollback。

### Decision: transcript 追加前显式清掉临时 footer
用户提交和 assistant 完成时，先移除当前 footer，再把新的 transcript block 追加到终端，最后重新绘制 footer。

这样可以保持两条稳定规则：
- transcript 只在事实内容新增时 append；
- footer 永远位于当前 transcript 之后，并且是唯一可重复重绘的区域。

备选方案：直接在 footer 下方继续写 transcript，再回到 footer 位置。放弃原因是 footer 本身是临时区域，若不先清理，会把 pending / composer 的旧内容遗留在 transcript 前后，破坏区域边界。

### Decision: full-region replay 只保留给 resize / final render
保留 `app-region` 这类“从 records 重放完整快照”的能力，但把它限定在两类场景：
- terminal columns 变化，需要 destructive recovery；
- 退出前需要输出最终静态快照。

这样既复用当前的 snapshot 重建能力，也避免把它误用到每次普通输入上。

备选方案：完全删除 full-region renderer。放弃原因是 resize destructive replay 仍然需要一条从 records 重建当前快照的路径，否则宽度变化后无法保证 banner、transcript 和 footer 的自洽布局。

## Risks / Trade-offs

- [Risk] footer-only redraw 与 resize replay 同时存在两套渲染路径，增加一点编排复杂度 → Mitigation：在 app 层明确区分“normal footer redraw”“transcript append”“destructive replay”三类入口，并为每类入口补测试。
- [Risk] 恢复 footer renderer 后，当前 `app-region` 的部分状态记录会不再用于 normal path → Mitigation：让 `app-region` 聚焦 resize/final render，避免它继续承担日常编辑路径的职责。
- [Risk] banner 高度或 transcript 样式变化后，依赖精确行数的测试可能继续脆弱 → Mitigation：优先断言渲染职责和关键区域存在性，而不是把每个视觉高度都写成固定数字。

## Migration Plan

1. 在 app 编排层恢复 footer-only normal path，并重新接入 footer renderer。
2. 把 transcript append 逻辑改回“clear footer → append block → render footer”。
3. 保留并收敛 full-region renderer，仅用于 resize destructive replay 和退出前最终渲染。
4. 更新自动化测试，覆盖普通输入不重放 banner/transcript、追加时只新增 transcript block、resize 时才 full replay。

本次变更只影响本地终端原型，无需数据迁移；若实现后发现 footer-only redraw 仍有明显回归，可以临时回滚到当前 full-region 方案，但需要接受 scrollback 残留问题重新出现。

## Open Questions

- 退出时是否仍然需要通过 full replay 输出一份“最终静态快照”，还是只清掉 footer 并保留现有 banner/transcript 输出即可？这个问题会影响 `renderFinal` 的职责边界，但不阻塞普通残留问题的修复。
