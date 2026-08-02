import { INPUT_EVENTS } from '../input/event-types';
import type {
  CommandHandler,
  CommandHost,
  CommandModelInfo as HostModelInfo,
  CommandModelInfoResult as HostModelInfoResult,
  CommandSession,
  InfoCommandSurface,
  SelectCommandSurface
} from '../types/command';
import type { InputEvent } from '../types/input';

export const MODEL_CONFIG_PATH_HINT = '~/.echo/config.json';

type ModelCommandInfo = HostModelInfo;
type ModelCommandInfoResult = HostModelInfoResult;

/**
 * 为 /model 创建 info surface，展示配置错误。
 *
 */
export function createModelSurface(modelCommandInfo: ModelCommandInfoResult): InfoCommandSurface {
  const error = 'error' in modelCommandInfo ? modelCommandInfo.error : undefined;
  const lines = [
    '当前未读取到模型配置。',
    error || `请检查 ${MODEL_CONFIG_PATH_HINT} 中的 llm.models 配置。`
  ];

  return {
    kind: 'info',
    title: '/model',
    lines,
    dismissHint: 'Esc 关闭'
  };
}

/**
 * 为 /model 创建模型选择 surface。
 *
 */
export function createModelSelectSurface(data: ModelCommandInfo): SelectCommandSurface {
  return {
    kind: 'select',
    title: `/model 选择模型 (${data.models.length})`,
    options: data.models.map((model) => ({
      label: model.model,
      description: model.provider
    })),
    selectedIndex: data.selectedIndex,
    dismissHint: 'Enter 选择 · Up/Down 移动 · Esc 取消'
  };
}

function createModelErrorSurface(error: string | undefined): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/model',
    lines: [
      '无法保存当前模型选择。',
      error || `请检查 ${MODEL_CONFIG_PATH_HINT} 是否可写。`
    ],
    dismissHint: 'Esc 关闭'
  };
}

function moveModelSelection(session: CommandSession<ModelCommandInfo>, direction: number, host: CommandHost): void {
  const data = session.data;

  if (!data) {
    return;
  }

  const modelCount = data.models.length;

  if (modelCount === 0) {
    return;
  }

  const selectedIndex = (data.selectedIndex + direction + modelCount) % modelCount;
  const nextData = {
    ...data,
    selectedIndex
  };

  host.session.update({
    surface: createModelSelectSurface(nextData),
    data: nextData
  });
}

function confirmModelSelection(
  session: CommandSession<ModelCommandInfo>,
  host: CommandHost
): void {
  const data = session.data;

  if (!data) {
    return;
  }

  const selectedModel = data.models[data.selectedIndex];

  if (!selectedModel) {
    return;
  }

  const result = host.model.selectModel(selectedModel.id);

  if (!result.ok) {
    host.session.update({
      surface: createModelErrorSurface(result.error),
      data
    });
    return;
  }

  host.session.close();
}

export class ModelCommandHandler implements CommandHandler<ModelCommandInfo> {
  name = 'model';
  description = '切换模型';

  /**
   * 只匹配 /model 和尾随空白，带参数输入继续走普通消息路径。
   *
   */
  match(text: string): boolean {
    return text.trimEnd() === '/model';
  }

  /**
   * 启动 /model，按配置打开模型信息或模型选择面板。
   *
   */
  start(_text: string, host: CommandHost): void {
    const modelCommandInfo = host.model.createModelCommandInfo();
    const data = 'models' in modelCommandInfo && modelCommandInfo.models.length > 0
      ? modelCommandInfo
      : null;
    host.session.open({
      commandName: 'model',
      handler: this,
      surface: data ? createModelSelectSurface(data) : createModelSurface(modelCommandInfo),
      data
    });
  }

  /**
   * /model 活跃时只消费 Esc 关闭面板，其余事件保持会话不变。
   *
   */
  handleEvent(session: CommandSession<ModelCommandInfo>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_UP) {
      moveModelSelection(session, -1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      moveModelSelection(session, 1, host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      confirmModelSelection(session, host);
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
    }
  }
}
