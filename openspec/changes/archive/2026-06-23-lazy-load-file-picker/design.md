## Context

当前 `@` file picker 的状态保存在 `FilePickerContext` 中。打开 picker 时会调用 `discoverProjectFiles(cwd)`，通过同步 `rg --files --hidden --sort path ...` 一次性获取 cwd 下全部文件路径，并把结果保存在 `state.paths`。目录进入/返回只是对这份 flat paths 做 prefix 投影，不会重新读取文件系统。

这个设计在单个项目仓库中通常足够快，但在 `/Users/example/projects` 这种包含大量仓库和文件的父目录中，`rg --files` 输出会超过 `spawnSync` 的 1MB `maxBuffer`，Node 以 `ENOBUFS` 终止子进程，当前代码又把非 0/1 status 当失败返回空数组，最终用户看到空的 file picker。目录本身可读，问题来自全量扫描策略和同步 buffer 限制。

## Goals / Non-Goals

**Goals:**
- 打开 `@` 时只读取当前 cwd 的直接子项，使大目录也能立即显示文件和子目录。
- 进入子目录时按需读取该目录的直接子项，避免提前扫描整个目录树。
- 保留现有文件选择、目录导航、preview、已选文件摘要和 mention 插入语义。
- query 过滤仍可用，并且不能因为大目录输出过大导致 picker 空白。
- 对目录读取失败、不可读或搜索失败提供可见反馈。

**Non-Goals:**
- 不引入后台文件索引、watcher、模糊搜索服务或第三方 TUI/file picker 依赖。
- 不改变 `@path` / `@"path with spaces"` mention 格式，也不改变提交时文件上下文注入逻辑。
- 不要求 file picker 展示文件大小、mtime、git status 或目录统计。
- 不解决所有外部 `rg` ignore 规则差异；只保证浏览直接子项不依赖全量 `rg --files`。

## Decisions

### 1. 浏览模式改为目录级同步懒加载

打开 picker 时读取 `cwd + currentDir` 的直接子项；进入目录时读取目标目录的直接子项；返回父目录时读取父目录直接子项。状态从“全局 flat paths + currentDir 投影”改为“当前目录 entries + 可选缓存”。

推荐数据流：

```text
open @
  └─ loadDirectory('')
       ├─ fs.readdir(cwd)
       └─ entries: [repo-a/, repo-b/, README.md]

Right / Enter on repo-a/
  └─ loadDirectory('repo-a')
       ├─ fs.readdir(cwd/repo-a)
       └─ entries: [src/, test/, package.json]
```

**Alternatives considered:**
- 继续使用 `rg --files`，只增大 `maxBuffer`：只能推迟问题，父目录更大时仍会失败，且打开 picker 仍会做大量无用工作。
- ENOBUFS 时使用 partial stdout：适合作为热修，但根目录显示仍依赖全量扫描，且目录只在有后代文件时才被发现。
- 异步 streaming `rg`：可以避免 buffer，但实现复杂度更高；本次需求是目录浏览懒加载，直接读取目录更贴近交互模型。

### 2. query 使用有界搜索，不影响普通目录浏览

当 query 为空时只展示当前目录直接子项。当 query 非空时，可以在 cwd 范围内做有界路径搜索，最多返回固定数量结果，并在达到上限或搜索失败时通过 notice/summary 告知用户。搜索实现可以继续使用 `rg --files`，但需要避免 `spawnSync` buffer 溢出；更稳妥的方式是 streaming 读取 stdout，到达上限后终止子进程。

为了降低实现风险，也可以先把 query 限定为“当前已加载目录的直接子项过滤”；但如果保留现有“按路径包含 query 全局过滤”的体验，就必须有硬上限和失败反馈。

**Alternatives considered:**
- query 只过滤当前目录：实现最简单，不会扫描大目录，但相对现有全路径搜索能力是体验收缩。
- query 继续全局搜索但同步 `execFileSync`：仍有 buffer 风险，不推荐。

### 3. 目录 entries 需要包含可见错误和空状态

目录读取失败不应表现为空白列表。`FilePickerContext` 应在 surface 中通过现有 `notice` 或新增空状态行表达：目录不可读、读取失败或没有可显示文件。renderer 可以继续使用两栏布局，但 preview 应在无 current entry 时显示“无可预览内容”或更具体说明。

**Alternatives considered:**
- 把错误吞掉并显示空列表：会让用户误判为目录真的为空，与当前 bug 现象类似。
- 把错误追加 transcript：不符合 file picker transient surface 语义。

### 4. 文件类型检测保持按需执行

当前 `createFileEntry` 会为每个文件读取最多 4096 bytes 判断文本/二进制。懒加载后直接子项数量通常较小，可以保留这个逻辑。对于 query 搜索结果，如果结果上限较大，需要注意类型检测会触发大量同步文件读取；实现时应保持搜索结果上限较小，或只对可见窗口/preview 当前项做更深检测。

**Alternatives considered:**
- 完全按扩展名判断文本文件：性能更好但准确性下降。
- 打开目录时递归检测所有后代：与懒加载目标冲突。

## Risks / Trade-offs

- [Risk] query 全局搜索如果实现不当仍可能卡住大目录或触发 buffer 限制 → Mitigation：使用 streaming + 结果上限，或先限定为当前目录过滤，并在 spec 中明确行为。
- [Risk] 目录懒加载后，目录 preview 不能再准确显示后代文件总数 → Mitigation：preview 显示直接子项数量或“按 → 进入目录”，不强制递归统计。
- [Risk] 同步 `fs.readdirSync` 在极大单层目录中仍可能有开销 → Mitigation：只读取一层，并限制渲染窗口；必要时后续再异步化。
- [Risk] 从 flat paths 改为 entries 状态会影响现有测试夹具 → Mitigation：补充目录导航、不可读目录、大目录和 query 行为测试，确保用户可见语义稳定。
