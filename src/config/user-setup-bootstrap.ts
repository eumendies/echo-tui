import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type BootstrapEchoUserSetupOptions = {
  configPath?: string;
  echoDir?: string;
  existsSync?: (filePath: string) => boolean;
  mkdirSync?: (dirPath: string, options: {recursive: boolean}) => unknown;
  writeFileSync?: (filePath: string, data: string, options?: {flag?: string}) => unknown;
};

type BootstrapEchoUserSetupResult = {
  configCreated: boolean;
  configPath: string;
  echoDir: string;
};

const DEFAULT_FAKE_PROVIDER_ID = 'default';
const DEFAULT_FAKE_MODEL_ID = 'default';

function getDefaultEchoDir(): string {
  return path.join(os.homedir(), '.echo');
}

/**
 * 初始化 echo-tui 用户目录；只补齐缺失的默认配置，避免覆盖用户已有内容。
 * echo-tui-setup 内置 skill 由 dist 包内的 builtin 资源提供，不向用户目录播种副本。
 */
function bootstrapEchoUserSetup(options: BootstrapEchoUserSetupOptions = {}): BootstrapEchoUserSetupResult {
  const echoDir = options.echoDir || path.join(os.homedir(), '.echo');
  const configPath = options.configPath || path.join(echoDir, 'config.json');
  const existsSync = options.existsSync || fs.existsSync;
  const mkdirSync = options.mkdirSync || fs.mkdirSync;
  const writeFileSync = options.writeFileSync || fs.writeFileSync;
  const configCreated = createFileIfMissing(configPath, `${JSON.stringify(createDefaultUserConfig(), null, 2)}\n`, {existsSync, mkdirSync, writeFileSync});

  return {
    configCreated,
    configPath,
    echoDir
  };
}

function createFileIfMissing(filePath: string, content: string, dependencies: Required<Pick<BootstrapEchoUserSetupOptions, 'existsSync' | 'mkdirSync' | 'writeFileSync'>>): boolean {
  if (dependencies.existsSync(filePath)) {
    return false;
  }

  dependencies.mkdirSync(path.dirname(filePath), {recursive: true});

  try {
    dependencies.writeFileSync(filePath, content, {flag: 'wx'});
    return true;
  } catch (error: unknown) {
    if (isNodeErrorCode(error, 'EEXIST')) {
      return false;
    }

    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function createDefaultUserConfig(): Record<string, unknown> {
  return {
    llm: {
      models: [
        {
          id: DEFAULT_FAKE_MODEL_ID,
          provider: DEFAULT_FAKE_PROVIDER_ID,
          model: 'echo-fake-agent',
          contextWindow: 128000
        }
      ],
      selectedModel: DEFAULT_FAKE_MODEL_ID,
      providers: {
        [DEFAULT_FAKE_PROVIDER_ID]: {
          preset: 'fake-agent',
          label: 'Fake Agent'
        }
      }
    }
  };
}


export {
  bootstrapEchoUserSetup,
  createDefaultUserConfig,
  getDefaultEchoDir,
};

export type {
  BootstrapEchoUserSetupOptions,
  BootstrapEchoUserSetupResult
};
