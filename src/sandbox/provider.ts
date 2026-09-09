import {createLinuxBubblewrapSandboxProvider} from './linux-bubblewrap';
import {createMacosSeatbeltSandboxProvider} from './macos-seatbelt';

import type {AgentExecutionMode, SandboxToolConfig} from '../types/agent';
import type {LinuxBubblewrapProviderOptions} from './linux-bubblewrap';
import type {MacosSeatbeltProviderOptions} from './macos-seatbelt';
import type {EffectiveSandbox, SandboxProvider, SandboxRuntimeContext} from './types';

// 两个平台 provider 可注入依赖的并集;公共字段签名一致,按平台各自取用不冲突。
type SandboxProviderOptions = MacosSeatbeltProviderOptions & LinuxBubblewrapProviderOptions;

type SandboxResolutionOptions = {
  platform?: NodeJS.Platform; // 运行平台;缺省取当前进程平台,测试可注入。
  providerOptions?: SandboxProviderOptions; // 透传给平台 provider 的可注入依赖。
};

/**
 * 按平台解析沙箱 provider;macOS 返回 Seatbelt 实现,Linux 返回 bubblewrap 实现,其他平台返回 null 表示不支持。
 */
function resolveSandboxProvider(platform: NodeJS.Platform = process.platform, options: SandboxProviderOptions = {}): SandboxProvider | null {
  if (platform === 'darwin') {
    return createMacosSeatbeltSandboxProvider(options);
  }

  if (platform === 'linux') {
    return createLinuxBubblewrapSandboxProvider(options);
  }

  return null;
}

function isHeadlessFullAccess(executionMode?: AgentExecutionMode): boolean {
  return executionMode?.kind === 'headless' && executionMode.approvalPolicy === 'full-access';
}

/**
 * 解析归一化后的生效沙箱状态;off 与 headless full-access 豁免在此统一收敛为 null,
 * read-only 禁网归一化也只在这里发生,供执行链路、transient 注记与 /status 共用。
 * 平台不支持时仍返回对象(provider 为 null),让展示层能区分降级原因而不是丢失策略。
 */
function resolveEffectiveSandbox(config: SandboxToolConfig, executionMode?: AgentExecutionMode, options: SandboxResolutionOptions = {}): EffectiveSandbox | null {
  if (config.mode === 'off' || isHeadlessFullAccess(executionMode)) {
    return null;
  }

  const provider = resolveSandboxProvider(options.platform ?? process.platform, options.providerOptions);

  return {
    policy: {
      mode: config.mode,
      // read-only 档语义恒为禁网,忽略配置中的 network 取值。
      network: config.mode === 'read-only' ? false : config.network,
      extraWritablePaths: [...config.extraWritablePaths]
    },
    provider,
    available: provider !== null && provider.isAvailable()
  };
}

/**
 * 执行链路使用的沙箱运行上下文;平台不支持时返回 null,provider 存在但不可用时仍返回,
 * 由 wrapCommand 在执行期自行降级为无沙箱。
 */
function resolveBashSandboxContext(config: SandboxToolConfig, executionMode?: AgentExecutionMode, options: SandboxResolutionOptions = {}): SandboxRuntimeContext | null {
  const effective = resolveEffectiveSandbox(config, executionMode, options);
  return effective?.provider ? {policy: effective.policy, provider: effective.provider} : null;
}

/**
 * 生成进入 transient 系统上下文的沙箱边界说明;沙箱未实际生效时返回 null,
 * 避免向模型描述不存在的限制导致命令失败被误判。
 * 用户配置的 extraWritablePaths 逐条列出,空列表时省略该措辞,保证模型能据此判断写边界。
 */
function createSandboxRuntimeNote(config: SandboxToolConfig, executionMode?: AgentExecutionMode, options: SandboxResolutionOptions = {}): string | null {
  const effective = resolveEffectiveSandbox(config, executionMode, options);
  if (!effective?.available) {
    return null;
  }

  if (effective.policy.mode === 'read-only') {
    return 'filesystem writes are limited to temp directories, the workspace is read-only, and network access is denied';
  }

  // note 只描述真实存在的边界;没有配置项时不保留类别措辞,避免给出模型无法核对的空描述。
  const extraPaths = effective.policy.extraWritablePaths;
  const extraPhrase = extraPaths.length > 0
    ? `, and the configured extra writable paths: ${extraPaths.join(', ')}`
    : '';

  return `filesystem writes are limited to the workspace, temp directories${extraPhrase}; network access is ${effective.policy.network ? 'allowed' : 'denied'}`;
}

export {
  createSandboxRuntimeNote,
  resolveBashSandboxContext,
  resolveEffectiveSandbox,
  resolveSandboxProvider
};

export type {
  SandboxProviderOptions,
  SandboxResolutionOptions
};
