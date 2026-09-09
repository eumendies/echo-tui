## 1. Provider 实现

- [x] 1.1 在 `src/sandbox/types.ts` 的 `SandboxProviderName` 联合类型中新增 `'linux-bubblewrap'`
- [x] 1.2 新建 `src/sandbox/linux-bubblewrap.ts`:实现 `createLinuxBubblewrapSandboxProvider`,包含二进制发现(优先 `/usr/bin/bwrap`,再按 `PATH` 顺序扫描,可注入)、试运行探测(`spawnSync` 执行 `bwrap --ro-bind / / /bin/true`,成功结果缓存在 provider 实例内)与 `wrapCommand` argv 生成
- [x] 1.3 实现 argv 生成规则:`--die-with-parent` 开头;禁网时追加 `--unshare-net`;依次 `--dev /dev`、`--proc /proc`、`--ro-bind / /`、`--tmpfs /tmp`;workspace-write 档追加工作区、`~/.echo/agent-memory` 与 `extraWritablePaths` 的 `--bind`(realpath 归一化,不存在的目录保留原路径);TMPDIR 不在 `/tmp` 下时补充 bind;尾部为 `<shell> -lc <command>`
- [x] 1.4 在 `src/sandbox/provider.ts` 的 `resolveSandboxProvider` 增加 `platform === 'linux'` 分支,并把解析选项从单一 `MacosSeatbeltProviderOptions` 扩展为按平台合并的可注入选项结构

## 2. 状态展示接线

- [x] 2.1 修改 `src/app/command/status-command-ports.ts`:沙箱降级原因按 provider 实现区分(macOS 为 `sandbox-exec 不可用`,Linux 为 bubblewrap 二进制缺失或试运行失败),`当前平台不支持沙箱` 分支保持不变

## 3. 测试

- [x] 3.1 扩展 `test/sandbox/provider.test.js`:Linux 平台解析出 bubblewrap provider、非 darwin/linux 平台返回无 provider、Linux 下策略与 transient 注记生效
- [x] 3.2 新建 `test/sandbox/bubblewrap-execution.test.js` 纯函数部分:argv 生成(mount 顺序、禁网开关、read-only 档、workspace-write 可写集、TMPDIR 特例、symlink 归一化)、二进制发现顺序、试运行缓存
- [x] 3.3 新建 `test/sandbox/bubblewrap-execution.test.js` 执行部分(环境跳过条件:非 linux 或试运行探测失败):写工作区成功、写工作区外被拒、read-only 档仅临时目录可写、禁网时网络访问被拒、timeout 与 Esc 中断语义不变、headless full-access 豁免

## 4. 文档与收尾

- [x] 4.1 更新 `docs/tui-architecture.md`「Bash 沙箱」一节:按平台分述 macOS Seatbelt 与 Linux bubblewrap,说明 argv 结构、可用性探测与 Ubuntu AppArmor 等发行版差异
- [x] 4.2 更新 `ROADMAP.md`:记录 Linux 沙箱(bubblewrap)完成情况
- [x] 4.3 运行完整验证序列:`npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;`
