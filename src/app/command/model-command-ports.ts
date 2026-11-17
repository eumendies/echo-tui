import type {CommandHostApp} from '../../types/command';
import type {AppContext} from '../state/app-context';

type ModelCommandContext = Pick<AppContext, 'clearContextUsage' | 'modelContext'>;

type ModelCommandPorts = Pick<CommandHostApp, 'model'>;

type ModelCommandPortOptions = {
  appContext: ModelCommandContext; // 共享模型状态与上下文用量失效入口。
  render: () => void; // provider 切换后重绘 footer 状态行；命令面板路径与静默参数路径共用。
};

/**
 * 创建模型和配置中心端口；用户配置写入只发布 Context revision，副作用统一交给订阅者。
 */
function createModelCommandPorts(options: ModelCommandPortOptions): ModelCommandPorts {
  const {appContext} = options;
  const render = options.render;

  return {
    model: {
      createModelCommandInfo() {
        return appContext.modelContext.createModelCommandInfo();
      },
      createEffortCommandInfo() {
        return appContext.modelContext.createEffortCommandInfo();
      },
      selectModel(modelId: string) {
        const result = appContext.modelContext.selectModel(modelId);

        if (result.ok) {
          appContext.clearContextUsage();
          // 带参数的命令不会打开 session，必须在这里重绘，否则用户看不到切换结果。
          render();
        }

        return result;
      },
      selectEffort(effort) {
        const result = appContext.modelContext.selectEffort(effort);

        if (result.ok) {
          appContext.clearContextUsage();
          // 同 selectModel：静默应用需要自行触发一次重绘。
          render();
        }

        return result;
      }
    }
  };
}

export {
  createModelCommandPorts
};

export type {
  ModelCommandPortOptions
};
