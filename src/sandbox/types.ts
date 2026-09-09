/**
 * 沙箱协议类型:策略由用户配置解析,provider 负责把原始 bash 命令包装为平台沙箱 spawn argv。
 * 沙箱定位为审批流之外的防御纵深,不是完整安全边界;平台差异必须全部收敛在 provider 实现内。
 */

export type SandboxMode = 'off' | 'read-only' | 'workspace-write'; // 沙箱档位:关闭 / 仅临时目录可写并禁网 / 工作区可写。

export type SandboxPolicy = {
  mode: SandboxMode; // 当前生效档位;off 时调用方不得请求包装。
  network: boolean; // 是否放行命令网络访问;read-only 档恒为 false。
  extraWritablePaths: string[]; // 用户追加的可写目录绝对路径;执行前由 provider realpath 归一化。
};

export type SandboxCommandInput = {
  command: string; // 原始 bash 命令文本,由 provider 原样交给底层 shell。
  shell: string; // 底层 shell 可执行文件路径。
  cwd: string; // 本次执行的工作目录;workspace-write 档的默认可写根。
};

export type SandboxProviderName = 'macos-seatbelt' | 'linux-bubblewrap'; // 平台实现的稳定标识,用于 /status 与诊断展示。

export type SandboxProvider = {
  name: SandboxProviderName; // 实现标识。
  isAvailable: () => boolean; // 沙箱工具是否存在于当前环境。
  describeUnavailable: () => string; // 不可用降级原因;仅在 isAvailable() 为 false 时由 /status 读取,供降级说明定位到具体实现。
  wrapCommand: (input: SandboxCommandInput, policy: SandboxPolicy) => string[] | null; // 返回完整 spawn argv;不可用或策略为 off 时返回 null,调用方按无沙箱执行。
};

export type SandboxRuntimeContext = {
  policy: SandboxPolicy; // 已解析且 mode 非 off 的策略。
  provider: SandboxProvider; // 平台解析出的 provider;可能 isAvailable() 为 false。
};

export type EffectiveSandbox = {
  policy: SandboxPolicy; // 归一化后的生效策略;read-only 档恒禁网,与配置原值无关。
  provider: SandboxProvider | null; // 平台 provider;非 darwin 等不支持平台为 null。
  available: boolean; // 沙箱在当前环境是否实际生效;provider 缺失或探测失败为 false。
};
