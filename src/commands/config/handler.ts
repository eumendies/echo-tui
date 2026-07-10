import {INPUT_EVENTS} from '../../input/event-types';
import {
  createConfigErrorSurface,
  createConfigSurface,
  createInitialConfigState,
  createResult
} from './state';
import {handleConfigPanelEvent} from './panel-state';
import type {
  CommandConfigListModelsResult,
  CommandHandler,
  CommandHost,
  CommandSession,
  ConfigCommandState
} from '../../types/command';
import type {InputEvent} from '../../types/input';
import type {ConfigCommandData} from './state';

function createModelListState(requestId: number, result: CommandConfigListModelsResult): NonNullable<ConfigCommandState['modelList']> {
  if (result.ok) {
    return {
      models: result.models,
      requestId,
      selectedIndex: 0,
      status: result.models.length > 0 ? 'ready' : 'empty',
      ...(result.truncated ? {truncated: true} : {})
    };
  }

  return {
    error: result.error,
    models: [],
    requestId,
    selectedIndex: 0,
    status: result.reason === 'unsupported' ? 'unsupported' : 'error'
  };
}

class ConfigCommandHandler implements CommandHandler<ConfigCommandData> {
  name = 'config';
  description = '配置 LLM providers 和 models';

  match(text: string): boolean {
    return String(text).trim() === '/config';
  }

  start(_text: string, host: CommandHost): void {
    host.composer.reset();

    try {
      const data: ConfigCommandData = {state: createInitialConfigState(host.config.readDraft())};
      host.session.open({
        commandName: 'config',
        handler: this,
        surface: createConfigSurface(data),
        data
      });
    } catch (error: unknown) {
      host.session.open({
        commandName: 'config',
        handler: this,
        surface: createConfigErrorSurface(error instanceof Error ? error.message : String(error)),
        data: null
      });
    }
  }

  async handleEvent(session: CommandSession<ConfigCommandData>, event: InputEvent, host: CommandHost): Promise<void> {
    const data = session.data;

    if (!data) {
      if (event.type === INPUT_EVENTS.ESCAPE) {
        host.session.close();
        host.composer.reset();
      }
      return;
    }

    if (data.result) {
      if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT) {
        host.session.close();
        host.composer.reset();
      }
      return;
    }

    if (!data.state) {
      return;
    }

    const result = handleConfigPanelEvent(data.state, event);

    if (result.kind === 'continue') {
      const nextData: ConfigCommandData = {state: result.state};
      host.session.update({surface: createConfigSurface(nextData), data: nextData});
      return;
    }

    if (result.kind === 'listModels') {
      const nextData: ConfigCommandData = {state: result.state};
      const requestId = result.state.modelList?.requestId;
      host.session.update({surface: createConfigSurface(nextData), data: nextData});

      if (requestId === undefined) {
        return;
      }

      const listResult = await host.config.listModels(result.provider);
      const activeSession = host.session.getActive() as CommandSession<ConfigCommandData> | null;
      const activeState = activeSession?.commandName === 'config' ? activeSession.data?.state : undefined;

      if (!activeState || activeState.modelList?.requestId !== requestId || activeState.mode !== 'modelList') {
        return;
      }

      const listedData: ConfigCommandData = {
        state: {...activeState, modelList: createModelListState(requestId, listResult)}
      };
      host.session.update({surface: createConfigSurface(listedData), data: listedData});
      return;
    }

    if (result.kind === 'cancel') {
      host.session.close();
      host.composer.reset();
      return;
    }

    const saveResult = host.config.saveDraft(result.draft);

    if (!saveResult.ok) {
      const nextData: ConfigCommandData = {state: {...result.state, error: saveResult.error || '无法保存配置'}};
      host.session.update({surface: createConfigSurface(nextData), data: nextData});
      return;
    }

    const nextData: ConfigCommandData = {result: createResult(result.state)};
    host.session.update({surface: createConfigSurface(nextData), data: nextData});
  }
}

export {
  ConfigCommandHandler,
  createModelListState
};
