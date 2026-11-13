import { INPUT_EVENTS } from '../input/event-types';
import type {
  CommandHandler,
  CommandHost,
  CommandModelProfile,
  CommandModelInfo as HostModelInfo,
  CommandModelInfoResult as HostModelInfoResult,
  CommandSession,
  InfoCommandSurface,
  SelectCommandSurface
} from '../types/command';
import type { InputEvent } from '../types/input';
import type {FooterMouseTarget} from '../types/render';

export const MODEL_CONFIG_PATH_HINT = '~/.echo/config.json';

type ModelCommandInfo = HostModelInfo;
type ModelCommandInfoResult = HostModelInfoResult;

const MODEL_COMMAND_PREFIX = '/model';

/**
 * 提取 `/model` 之后的参数；无参数返回 null。
 * 保留内部空白，以支持含空格的模型名。
 */
function parseModelArgument(text: string): string | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith(MODEL_COMMAND_PREFIX)) {
    return null;
  }

  const rest = trimmed.slice(MODEL_COMMAND_PREFIX.length).trim();
  return rest === '' ? null : rest;
}

/**
 * 按面板展示的模型名解析 profile，大小写不敏感精确匹配。
 * 返回全部命中项，由调用方区分唯一命中、未命中与多命中。
 */
function resolveModelQuery(models: readonly CommandModelProfile[], query: string): CommandModelProfile[] {
  const normalized = query.toLowerCase();

  return models.filter((model) => model.model.toLowerCase() === normalized);
}

/** 为无法唯一匹配的 `/model` 参数创建候选 surface，当前生效项以 `*` 标记。 */
function createModelQuerySurface(data: ModelCommandInfo, query: string): InfoCommandSurface {
  const matched = resolveModelQuery(data.models, query);

  return {
    kind: 'info',
    title: '/model',
    lines: [
      matched.length === 0 ? `无法匹配模型：${query}` : `匹配到 ${matched.length} 个模型：${query}`,
      '可用模型：',
      ...data.models.map((model, index) => `${index === data.selectedIndex ? '*' : ' '} ${model.model}  (${model.provider})`)
    ],
    dismissHint: 'Esc 关闭'
  };
}

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

function selectModelIndex(session: CommandSession<ModelCommandInfo>, index: number, host: CommandHost): ModelCommandInfo | null {
  const data = session.data;
  const selectedModel = Number.isInteger(index) ? data?.models[index] : undefined;

  if (!data || !selectedModel) {
    return null;
  }

  const nextData = {...data, selectedIndex: index};
  if (index !== data.selectedIndex) {
    host.session.update({
      surface: createModelSelectSurface(nextData),
      data: nextData
    });
  }

  return nextData;
}

function confirmModelSelection(
  session: CommandSession<ModelCommandInfo>,
  host: CommandHost
): void {
  const data = session.data;

  if (data) {
    confirmModelData(data, host);
  }
}

function confirmModelData(data: ModelCommandInfo, host: CommandHost): void {
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
   * 接管 /model、尾随空白与空格分隔参数；`/modelx` 这类前缀不匹配。
   */
  match(text: string): boolean {
    return /^\/model(?:\s+[\s\S]*)?$/.test(text);
  }

  /**
   * 无参数打开模型选择面板；带参数时按模型名直接切换，
   * 无法唯一匹配则展示候选，配置错误与保存失败复用既有 surface。
   */
  start(text: string, host: CommandHost): void {
    const query = parseModelArgument(text);

    if (query !== null) {
      this.startWithArgument(query, host);
      return;
    }

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

  private startWithArgument(query: string, host: CommandHost): void {
    const modelCommandInfo = host.model.createModelCommandInfo();

    if (!('models' in modelCommandInfo) || modelCommandInfo.models.length === 0) {
      host.session.open({
        commandName: 'model',
        handler: this,
        surface: createModelSurface(modelCommandInfo),
        data: null
      });
      return;
    }

    const matched = resolveModelQuery(modelCommandInfo.models, query);

    // 未命中与多命中都不能静默取第一个，交给候选 surface 由用户确认。
    if (matched.length !== 1) {
      host.session.open({
        commandName: 'model',
        handler: this,
        surface: createModelQuerySurface(modelCommandInfo, query),
        data: null
      });
      return;
    }

    const result = host.model.selectModel(matched[0].id);

    if (!result.ok) {
      host.session.open({
        commandName: 'model',
        handler: this,
        surface: createModelErrorSurface(result.error),
        data: null
      });
    }
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

  handlePointer(session: CommandSession<ModelCommandInfo>, target: FooterMouseTarget, activate: boolean, host: CommandHost): void {
    if (target.kind !== 'command_select_option' || session.surface.kind !== 'select') {
      return;
    }

    const data = selectModelIndex(session, target.index, host);
    if (data && activate) {
      confirmModelData(data, host);
    }
  }
}

export {createModelQuerySurface, parseModelArgument, resolveModelQuery};
