import {isAbsolute} from 'node:path';

import {SANDBOX_MODES} from './llm-config';

import type {SandboxConfigDraft} from '../types/command';

type JsonObject = Record<string, unknown>;

class SandboxConfigEditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxConfigEditorError';
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 从配置根读取沙箱草稿；缺省值与解析层 readSandboxToolConfig 保持一致（workspace-write、网络开启、空数组）。
 * 非法字段就地回退缺省，由保存校验负责把文件修正为合法值。
 */
function createSandboxConfigDraft(rootConfig: JsonObject): SandboxConfigDraft {
  const tools = isJsonObject(rootConfig.tools) ? rootConfig.tools : {};
  const sandbox = isJsonObject(tools.sandbox) ? tools.sandbox : {};
  const mode = sandbox.mode;
  const network = sandbox.network;
  const extraWritablePaths = sandbox.extraWritablePaths;

  return {
    mode: typeof mode === 'string' && (SANDBOX_MODES as readonly string[]).includes(mode)
      ? mode as SandboxConfigDraft['mode']
      : 'workspace-write',
    network: typeof network === 'boolean' ? network : true,
    extraWritablePaths: Array.isArray(extraWritablePaths)
      ? extraWritablePaths.filter((item): item is string => typeof item === 'string')
      : []
  };
}

/**
 * 校验沙箱草稿并写回配置根的 tools.sandbox；失败抛出带字段语境的错误，调用方据此阻止落盘。
 * 保留 sandbox 节点内未知字段，避免保存销毁用户手工写入的扩展配置。
 */
function applySandboxConfigDraft(rootConfig: JsonObject, draft: SandboxConfigDraft): void {
  if (!(SANDBOX_MODES as readonly string[]).includes(draft.mode)) {
    throw new SandboxConfigEditorError(`tools.sandbox.mode 必须是 ${SANDBOX_MODES.join('、')}`);
  }

  if (typeof draft.network !== 'boolean') {
    throw new SandboxConfigEditorError('tools.sandbox.network 必须是布尔值');
  }

  if (!Array.isArray(draft.extraWritablePaths)) {
    throw new SandboxConfigEditorError('tools.sandbox.extraWritablePaths 必须是字符串数组');
  }

  const paths: string[] = [];
  const seenPaths = new Set<string>();

  for (let index = 0; index < draft.extraWritablePaths.length; index += 1) {
    const item = draft.extraWritablePaths[index];

    if (typeof item !== 'string' || item.trim() === '' || !isAbsolute(item)) {
      throw new SandboxConfigEditorError(`tools.sandbox.extraWritablePaths[${index}] 必须是非空绝对路径`);
    }

    if (seenPaths.has(item)) {
      throw new SandboxConfigEditorError(`tools.sandbox.extraWritablePaths[${index}] 与已有路径重复：${item}`);
    }

    seenPaths.add(item);
    paths.push(item);
  }

  const tools = isJsonObject(rootConfig.tools) ? {...rootConfig.tools} : {};
  const sandbox = isJsonObject(tools.sandbox) ? tools.sandbox : {};
  tools.sandbox = {...sandbox, mode: draft.mode, network: draft.network, extraWritablePaths: paths};
  rootConfig.tools = tools;
}

export {
  SandboxConfigEditorError,
  applySandboxConfigDraft,
  createSandboxConfigDraft
};
