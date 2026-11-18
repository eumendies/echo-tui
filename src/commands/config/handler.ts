import {isAbsolute} from 'node:path';

import {BUILT_IN_SYSTEM_PROMPT} from '../../agent/context/system-prompt';
import {projectSystemPromptRead} from '../../render/footer/system-prompt-surface';
import {INPUT_EVENTS} from '../../input/event-types';
import * as composer from '../../input/composer';
import {HISTORY_RENDER_LINE_LIMIT_OPTIONS} from '../../config/app-settings-config';
import {
  CONFIG_TABS,
  getGeneralConfigRowIds,
  createConfigSurface,
  createInitialAppearanceConfigState,
  createInitialConfigState,
  createInitialGeneralConfigState,
  createInitialSandboxConfigState,
  createInitialSystemPromptConfigState,
  createInitialToolsConfigState,
  describeSystemPromptFallback,
  isToolsConfigDirty,
  markToolsConfigSaved,
  getSandboxConfigRowIds,
  isGeneralConfigDirty,
  isModelConfigDirty,
  isSandboxConfigDirty,
  markGeneralConfigSaved,
  markModelConfigSaved,
  markSandboxConfigSaved,
  withSystemPromptSnapshot,
  SANDBOX_MODE_CYCLE
} from './state';
import {handleConfigPanelEvent} from './panel-state';

import type {
  AppearanceConfigState,
  CommandConfigListModelsResult,
  CommandHandler,
  CommandHost,
  CommandSession,
  ConfigCommandState,
  CommandSystemPromptReadResult,
  ConfigTabId,
  GeneralConfigState,
  SandboxConfigState,
  SystemPromptConfigState,
  ToolsConfigState
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


/**
 * 管理带 Tab 的配置中心；子面板只处理领域状态，文件和重绘副作用经 CommandHost 执行。
 */
class ConfigCommandHandler implements CommandHandler<ConfigCommandData> {
  name = 'config';
  description = '配置常规设置、指令文件、模型、主 Agent 工具、沙箱和主题';

  match(text: string): boolean {
    return text.trimEnd() === '/config';
  }

  start(_text: string, host: CommandHost): void {
    const data = initializeTab({activeTab: 'general'}, 'general', host);
    host.session.open({
      commandName: 'config',
      handler: this,
      surface: createConfigSurface(data),
      data
    });
  }

  async handleEvent(session: CommandSession<ConfigCommandData>, event: InputEvent, host: CommandHost): Promise<void> {
    const data = session.data;
    if (!data) {
      return;
    }

    if (data.discardConfirm) {
      this.handleDiscardConfirm(data, event, host);
      return;
    }

    if (data.systemPrompt) {
      this.handleSystemPromptEvent(data, data.systemPrompt, event, host);
      return;
    }

    if (event.type === INPUT_EVENTS.TAB) {
      const currentIndex = CONFIG_TABS.findIndex((tab) => tab.id === data.activeTab);
      const nextTab = CONFIG_TABS[(currentIndex + 1) % CONFIG_TABS.length].id;
      this.update(initializeTab({...data, activeTab: nextTab}, nextTab, host), host);
      return;
    }

    const activeSlot = data[data.activeTab];
    if (activeSlot?.error) {
      if (event.type === INPUT_EVENTS.ESCAPE) {
        this.requestClose(data, host);
      }
      return;
    }

    if (data.activeTab === 'general' && data.general?.state) {
      this.handleGeneralEvent(data, data.general.state, event, host);
      return;
    }

    if (data.activeTab === 'tools' && data.tools?.state) {
      this.handleToolsEvent(data, data.tools.state, event, host);
      return;
    }

    if (data.activeTab === 'sandbox' && data.sandbox?.state) {
      this.handleSandboxEvent(data, data.sandbox.state, event, host);
      return;
    }

    if (data.activeTab === 'appearance' && data.appearance?.state) {
      this.handleAppearanceEvent(data, data.appearance.state, event, host);
      return;
    }

    if (data.activeTab === 'models' && data.models?.state) {
      await this.handleModelEvent(data, data.models.state, event, host);
    }
  }

  /**
   * 在常规快照中编辑草稿；消息策略支持 Enter 与方向键切换，只有保存行会经 host 写入配置。
   */
  private handleGeneralEvent(data: ConfigCommandData, state: GeneralConfigState, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.requestClose(data, host);
      return;
    }

    let nextState = structuredClone(state);
    nextState.error = undefined;
    nextState.feedback = undefined;

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      nextState.selectedIndex = clamp(nextState.selectedIndex + delta, 0, getGeneralConfigRowIds(nextState).length - 1);
    } else if (event.type === INPUT_EVENTS.MOVE_LEFT || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      nextState = adjustGeneralValue(nextState, event.type === INPUT_EVENTS.MOVE_LEFT ? -1 : 1);
    } else if (event.type === INPUT_EVENTS.SUBMIT) {
      const selectedRow = getGeneralConfigRowIds(nextState)[nextState.selectedIndex];
      if (selectedRow === 'reasoningSummary') {
        nextState.draft.showReasoningSummary = !nextState.draft.showReasoningSummary;
      } else if (selectedRow === 'mouseInteraction') {
        nextState.draft.mouseInteractionEnabled = !nextState.draft.mouseInteractionEnabled;
      } else if (selectedRow === 'autoCompressImages') {
        nextState.draft.autoCompressImages = !nextState.draft.autoCompressImages;
      } else if (selectedRow === 'checkUpdatesOnStartup') {
        nextState.draft.checkUpdatesOnStartup = !nextState.draft.checkUpdatesOnStartup;
      } else if (selectedRow === 'activeTurnMessagePolicy') {
        nextState = adjustGeneralValue(nextState, 1);
      } else if (selectedRow === 'systemPrompt') {
        const read = host.config.readSystemPrompt({includeDynamicSections: true});
        if (!read.ok) {
          nextState.error = read.error;
        } else {
          this.update({
            ...data,
            general: {state: nextState},
            systemPrompt: createInitialSystemPromptConfigState(read.snapshot, read.dynamicSections ?? [])
          }, host);
          return;
        }
      } else if (selectedRow === 'save') {
        const result = host.config.saveSettings(nextState.draft);
        nextState = result.ok
          ? markGeneralConfigSaved(nextState)
          : {...nextState, error: result.error || '无法保存常规设置'};
      }
    }

    nextState.selectedIndex = clamp(nextState.selectedIndex, 0, getGeneralConfigRowIds(nextState).length - 1);

    this.update({...data, general: {state: nextState}}, host);
  }

  /**
   * 处理系统提示词子视图事件；按 mode 分发，所有文件副作用都经 host.config 端口。
   */
  private handleSystemPromptEvent(data: ConfigCommandData, state: SystemPromptConfigState, event: InputEvent, host: CommandHost): void {
    // menu 与阅读态允许 Tab 退出视图并继续切页；编辑与确认态忽略以免误丢草稿。
    if (event.type === INPUT_EVENTS.TAB && (state.mode === 'menu' || state.mode === 'read')) {
      const currentIndex = CONFIG_TABS.findIndex((tab) => tab.id === data.activeTab);
      const nextTab = CONFIG_TABS[(currentIndex + 1) % CONFIG_TABS.length].id;
      this.leaveSystemPromptView(data, host, nextTab);
      return;
    }

    if (state.mode === 'menu') {
      this.handleSystemPromptMenu(data, state, event, host);
      return;
    }

    if (state.mode === 'read') {
      this.handleSystemPromptRead(data, state, event, host);
      return;
    }

    if (state.mode === 'edit') {
      this.handleSystemPromptEdit(data, state, event, host);
      return;
    }

    this.handleSystemPromptConfirm(data, state, event, host);
  }

  /** menu 只移动按钮焦点；删除行在目标缺失时给出提示而不写盘。 */
  private handleSystemPromptMenu(data: ConfigCommandData, state: SystemPromptConfigState, event: InputEvent, host: CommandHost): void {
    const next = structuredClone(state);
    next.error = undefined;
    next.feedback = undefined;
    const rows = next.menuRows;

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.leaveSystemPromptView(data, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      next.selectedIndex = clamp(next.selectedIndex + delta, 0, rows.length - 1);
      this.update({...data, systemPrompt: next}, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_HOME || event.type === INPUT_EVENTS.MOVE_END) {
      next.selectedIndex = event.type === INPUT_EVENTS.MOVE_HOME ? 0 : rows.length - 1;
      this.update({...data, systemPrompt: next}, host);
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    const row = rows[next.selectedIndex];

    if (row.id === 'back') {
      this.leaveSystemPromptView(data, host);
      return;
    }

    if (!row.available) {
      this.update({...data, systemPrompt: {...next, error: '目标文件不存在'}}, host);
      return;
    }

    if (row.id === 'view') {
      this.update({...data, systemPrompt: {...next, mode: 'read', readScroll: 0}}, host);
      return;
    }

    if (row.id === 'editProject' || row.id === 'editGlobal') {
      const target = row.id === 'editProject' ? 'project' : 'global';
      const fact = target === 'project' ? next.project : next.global;
      // 文件已存在时从磁盘内容起步；缺失时预填内置文本，使“新建”与“修改”同交互。
      const initial = fact.exists && typeof fact.content === 'string' ? fact.content : BUILT_IN_SYSTEM_PROMPT;
      this.update({
        ...data,
        systemPrompt: {
          ...next,
          confirmIndex: 0,
          draft: composer.createComposer(initial),
          mode: 'edit',
          pendingOverwrites: false,
          target
        }
      }, host);
      return;
    }

    const deleteTarget = row.id === 'deleteProject' ? 'project' : 'global';
    this.update({
      ...data,
      systemPrompt: {
        ...next,
        confirmIndex: 0,
        mode: 'confirmReset',
        pendingFallback: describeSystemPromptFallback(next, deleteTarget),
        target: deleteTarget
      }
    }, host);
  }

  /** 阅读态只移动滚动偏移；不写盘、不改草稿。 */
  private handleSystemPromptRead(data: ConfigCommandData, state: SystemPromptConfigState, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.update({...data, systemPrompt: {...structuredClone(state), mode: 'menu', readScroll: 0}}, host);
      return;
    }

    const viewport = host.status.getViewport();
    // 折行后一屏覆盖的逻辑行数取决于终端宽度，滚动上限必须与 renderer 共用同一次投影。
    const projection = projectSystemPromptRead({
      columns: viewport.width,
      content: state.baseContent,
      maxLines: viewport.maxLines,
      offset: state.readScroll
    });
    const page = Math.max(1, projection.viewport);
    const delta = event.type === INPUT_EVENTS.MOVE_UP
      ? -1
      : event.type === INPUT_EVENTS.MOVE_DOWN
        ? 1
        : event.type === INPUT_EVENTS.PAGE_UP
          ? -page
          : event.type === INPUT_EVENTS.PAGE_DOWN
            ? page
            : 0;

    if (delta === 0) {
      return;
    }

    const next = projectSystemPromptRead({
      columns: viewport.width,
      content: state.baseContent,
      maxLines: viewport.maxLines,
      offset: state.readScroll + delta
    });

    this.update({
      ...data,
      systemPrompt: {...state, readScroll: next.start}
    }, host);
  }

  /** 编辑态使用多行 composer；Enter 只进入确认，不直接写盘。 */
  private handleSystemPromptEdit(data: ConfigCommandData, state: SystemPromptConfigState, event: InputEvent, host: CommandHost): void {
    const draft = state.draft;

    // 编辑态草稿由 menu 打开时创建；缺失说明状态机被破坏，忽略事件而不是伪造空草稿。
    if (!draft) {
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.update({...data, systemPrompt: {...state, draft: undefined, mode: 'menu'}}, host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      const fact = state.target === 'project' ? state.project : state.global;
      this.update({
        ...data,
        systemPrompt: {
          ...state,
          confirmIndex: 0,
          draft,
          error: undefined,
          mode: 'confirmSave',
          pendingOverwrites: fact.exists
        }
      }, host);
      return;
    }

    if (event.type === INPUT_EVENTS.INSERT_NEWLINE) {
      composer.insertNewline(draft);
    } else if (event.type === INPUT_EVENTS.MOVE_UP) {
      composer.moveUp(draft);
    } else if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      composer.moveDown(draft);
    } else if (!composer.applyComposerEditEvent(draft, event)) {
      return;
    }

    this.update({...data, systemPrompt: {...state, draft, error: undefined}}, host);
  }

  /** 确认态只做二选一；执行动作后统一回 menu 并用新快照刷新。 */
  private handleSystemPromptConfirm(data: ConfigCommandData, state: SystemPromptConfigState, event: InputEvent, host: CommandHost): void {
    const isSave = state.mode === 'confirmSave';
    const next = structuredClone(state);
    next.error = undefined;
    next.feedback = undefined;

    if (event.type === INPUT_EVENTS.ESCAPE) {
      next.mode = isSave ? 'edit' : 'menu';
      if (!isSave) {
        next.pendingFallback = undefined;
      }
      this.update({...data, systemPrompt: next}, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_LEFT) {
      this.update({...data, systemPrompt: {...next, confirmIndex: 0}}, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      this.update({...data, systemPrompt: {...next, confirmIndex: 1}}, host);
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    if (next.confirmIndex === 1) {
      next.mode = isSave ? 'edit' : 'menu';
      if (!isSave) {
        next.pendingFallback = undefined;
      }
      this.update({...data, systemPrompt: next}, host);
      return;
    }

    const target = next.target;

    if (!isSave) {
      const result = host.config.deleteSystemPrompt(target);

      if (!result.ok) {
        this.update({...data, systemPrompt: {...next, error: result.error}}, host);
        return;
      }

      this.finishSystemPromptMutation(data, next, host, (refreshed) => (
        `✓ 已删除 ${result.filePath}，回落到 ${describeSystemPromptFallback(refreshed, target)}`
      ));
      return;
    }

    const draft = next.draft;

    if (!draft) {
      return;
    }

    const result = host.config.saveSystemPrompt(target, composer.getText(draft));

    if (!result.ok) {
      this.update({...data, systemPrompt: {...next, error: result.error}}, host);
      return;
    }

    if (result.unchanged) {
      this.finishSystemPromptMutation(data, next, host, () => '内容未变化，未写入文件');
      return;
    }

    this.finishSystemPromptMutation(data, next, host, () => `✓ 已保存 ${result.filePath}，下一轮 assistant run 生效`);
  }

  /**
   * 写入或删除成功后回到 menu 并用新快照刷新；快照刷新失败时保留操作结果并提示原因。
   */
  private finishSystemPromptMutation(data: ConfigCommandData, state: SystemPromptConfigState, host: CommandHost, buildFeedback: (refreshed: SystemPromptConfigState) => string): void {
    const {general, read} = this.refreshSystemPromptFacts(data, host);
    const base: SystemPromptConfigState = {
      ...state,
      confirmIndex: 0,
      draft: undefined,
      error: undefined,
      mode: 'menu',
      pendingFallback: undefined,
      pendingOverwrites: false
    };

    if (!read.ok) {
      this.update({...data, general, systemPrompt: {...base, error: read.error}}, host);
      return;
    }

    // 动态段只取决于 cwd、指令链与 skill/memory 目录，文件写入不改变它们，沿用进入时的结果。
    const refreshed = withSystemPromptSnapshot(base, read.snapshot, state.dynamicSections);
    this.update({
      ...data,
      general,
      systemPrompt: {...refreshed, feedback: buildFeedback(refreshed)}
    }, host);
  }

  /** 退出子视图回到常规 Tab；顺手刷新摘要行，保持与磁盘一致。 */
  private leaveSystemPromptView(data: ConfigCommandData, host: CommandHost, nextTab?: ConfigTabId): void {
    const {general} = this.refreshSystemPromptFacts(data, host);
    const cleared: ConfigCommandData = {
      ...data,
      general,
      systemPrompt: undefined
    };

    if (!nextTab) {
      this.update(cleared, host);
      return;
    }

    this.update(initializeTab({...cleared, activeTab: nextTab}, nextTab, host), host);
  }

  /**
   * 重新读取文件事实并同步常规 Tab 摘要；两个调用点都不需要动态段摘要。
   */
  private refreshSystemPromptFacts(data: ConfigCommandData, host: CommandHost): {general: ConfigCommandData['general']; read: CommandSystemPromptReadResult} {
    const read = host.config.readSystemPrompt();

    if (!read.ok || !data.general?.state) {
      return {general: data.general, read};
    }

    return {
      general: {state: {...data.general.state, systemPromptSummary: {kind: read.snapshot.sourceKind}}},
      read
    };
  }

  /** 仅编辑工具页草稿；Bash 锁定、Todo 成对切换，离线工具不受可用性限制。 */
  private handleToolsEvent(data: ConfigCommandData, state: ToolsConfigState, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.requestClose(data, host);
      return;
    }
    let nextState = structuredClone(state);
    nextState.error = undefined;
    nextState.feedback = undefined;
    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const up = event.type === INPUT_EVENTS.MOVE_UP;
      nextState.selectedIndex = clamp(state.selectedIndex + (up ? -1 : 1), 0, state.items.length);
    } else if (event.type === INPUT_EVENTS.MOVE_HOME || event.type === INPUT_EVENTS.MOVE_END) {
      nextState.selectedIndex = event.type === INPUT_EVENTS.MOVE_HOME ? 0 : state.items.length;
    } else if (event.type === INPUT_EVENTS.SUBMIT || (event.type === INPUT_EVENTS.TEXT && event.value === ' ')) {
      const item = nextState.items[nextState.selectedIndex];
      if (item && !item.names.includes('run_bash_command')) {
        const disabled = new Set(nextState.draft.disabledTools);
        const enable = item.names.some((name) => disabled.has(name));
        for (const name of item.names) {
          if (enable) disabled.delete(name);
          else disabled.add(name);
        }
        nextState.draft.disabledTools = [...disabled];
      } else if (!item && event.type === INPUT_EVENTS.SUBMIT) {
        const result = host.config.saveToolsDraft(nextState.draft);
        nextState = result.ok ? markToolsConfigSaved(nextState) : {...nextState, error: result.error || '无法保存主 Agent 工具设置'};
      }
    }
    this.update({...data, tools: {state: nextState}}, host);
  }

  private handleSandboxEvent(data: ConfigCommandData, state: SandboxConfigState, event: InputEvent, host: CommandHost): void {
    // 行内输入模式下接管文本编辑事件,列表导航与保存动作暂停。
    if (state.pathInput !== undefined) {
      this.handleSandboxPathInput(data, state, event, host);
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.requestClose(data, host);
      return;
    }

    let nextState = structuredClone(state);
    nextState.error = undefined;
    nextState.feedback = undefined;

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      const rowIds = getSandboxConfigRowIds(nextState);
      let target = nextState.selectedIndex + delta;
      // 分组标题行不可选中:焦点移动时直接越过,保证选中行始终是真实配置行。
      while (rowIds[target] === 'header') {
        target += delta;
      }
      nextState.selectedIndex = clamp(target, 0, rowIds.length - 1);
    } else if (event.type === INPUT_EVENTS.MOVE_LEFT || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      adjustSandboxValue(nextState, event.type === INPUT_EVENTS.MOVE_LEFT ? -1 : 1);
    } else if (event.type === INPUT_EVENTS.SUBMIT) {
      const selectedRow = getSandboxConfigRowIds(nextState)[nextState.selectedIndex];
      if (selectedRow === 'network') {
        nextState.draft.network = !nextState.draft.network;
      } else if (selectedRow.startsWith('path:')) {
        const removedIndex = Number(selectedRow.slice('path:'.length));
        nextState.draft.extraWritablePaths.splice(removedIndex, 1);
        // 删除后焦点回到相邻路径行;没有路径行时落到添加行,避免焦点漂到保存行造成误触保存。
        const nextSelectedRow = nextState.draft.extraWritablePaths.length > 0
          ? `path:${Math.min(removedIndex, nextState.draft.extraWritablePaths.length - 1)}`
          : 'addPath';
        nextState.selectedIndex = getSandboxConfigRowIds(nextState).findIndex((rowId) => rowId === nextSelectedRow);
      } else if (selectedRow === 'addPath') {
        nextState.pathInput = '';
      } else if (selectedRow === 'save') {
        const result = host.config.saveSandboxDraft(nextState.draft);
        nextState = result.ok
          ? markSandboxConfigSaved(nextState)
          : {...nextState, error: result.error || '无法保存沙箱设置'};
      }
    }

    nextState.selectedIndex = clamp(nextState.selectedIndex, 0, getSandboxConfigRowIds(nextState).length - 1);

    this.update({...data, sandbox: {state: nextState}}, host);
  }

  private handleSandboxPathInput(data: ConfigCommandData, state: SandboxConfigState, event: InputEvent, host: CommandHost): void {
    const nextState = structuredClone(state);
    const buffer = nextState.pathInput ?? '';

    if (event.type === INPUT_EVENTS.TEXT && typeof event.value === 'string') {
      // 正常输入时清掉旧错误提示,避免提示残留。
      nextState.error = undefined;
      const merged = buffer + event.value;
      if (Array.from(merged).length <= SANDBOX_PATH_INPUT_MAX) {
        nextState.pathInput = merged;
      } else {
        // 超过上限时保持缓冲不变并明确报错,绝不静默丢弃任何已输入字符。
        nextState.error = `路径太长：最多 ${SANDBOX_PATH_INPUT_MAX} 个字符`;
      }
    } else if (event.type === INPUT_EVENTS.BACKSPACE) {
      nextState.error = undefined;
      nextState.pathInput = Array.from(buffer).slice(0, -1).join('');
    } else if (event.type === INPUT_EVENTS.ESCAPE) {
      nextState.pathInput = undefined;
    } else if (event.type === INPUT_EVENTS.SUBMIT) {
      const candidate = buffer.trim();

      if (candidate === '') {
        nextState.error = '路径不能为空';
      } else if (!isAbsolute(candidate)) {
        nextState.error = '路径必须是绝对路径';
      } else if (nextState.draft.extraWritablePaths.includes(candidate)) {
        nextState.error = `路径已存在：${candidate}`;
      } else {
        nextState.draft.extraWritablePaths.push(candidate);
        nextState.pathInput = undefined;
        nextState.selectedIndex = getSandboxConfigRowIds(nextState).findIndex((rowId) => rowId === `path:${nextState.draft.extraWritablePaths.length - 1}`);
      }
    } else {
      // 输入模式下忽略其余事件(移动键等),保持输入状态。
      return;
    }

    this.update({...data, sandbox: {state: nextState}}, host);
  }

  private handleAppearanceEvent(data: ConfigCommandData, state: AppearanceConfigState, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.requestClose(data, host);
      return;
    }

    if (state.themes.length === 0) {
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      const nextState = {...state, error: undefined, feedback: undefined, selectedIndex: clamp(state.selectedIndex + delta, 0, state.themes.length - 1)};
      this.update({...data, appearance: {state: nextState}}, host);
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    const selectedTheme = state.themes[state.selectedIndex];
    if (!selectedTheme) {
      return;
    }

    const previousThemes = state.themes.map((theme) => ({...theme}));
    const optimisticState: AppearanceConfigState = {
      ...state,
      error: undefined,
      feedback: '✓ 主题已保存',
      themes: state.themes.map((theme) => ({...theme, selected: theme.id === selectedTheme.id}))
    };
    const optimisticData = {...data, appearance: {state: optimisticState}};
    this.update(optimisticData, host);
    const result = host.theme.selectTheme(selectedTheme.id);

    if (!result.ok) {
      this.update({
        ...data,
        appearance: {
          state: {
            ...state,
            themes: previousThemes,
            error: result.error,
            feedback: undefined
          }
        }
      }, host);
    }
  }

  private async handleModelEvent(data: ConfigCommandData, state: ConfigCommandState, event: InputEvent, host: CommandHost): Promise<void> {
    if (event.type === INPUT_EVENTS.ESCAPE && state.mode === 'list' && !state.editTarget) {
      this.requestClose(data, host);
      return;
    }

    const result = handleConfigPanelEvent({...state, feedback: undefined}, event);

    if (result.kind === 'continue') {
      this.update({...data, models: {state: result.state}}, host);
      return;
    }

    if (result.kind === 'listModels') {
      const requestId = result.state.modelList?.requestId;
      this.update({...data, models: {state: result.state}}, host);

      if (requestId === undefined) {
        return;
      }

      const listResult = await host.config.listModels(result.provider);
      const activeSession = host.session.getActive() as CommandSession<ConfigCommandData> | null;
      const activeState = activeSession?.data?.models?.state;

      if (!activeState || activeState.modelList?.requestId !== requestId || activeState.mode !== 'modelList') {
        return;
      }

      const nextData = activeSession?.data as ConfigCommandData;
      this.update({...nextData, models: {state: {...activeState, modelList: createModelListState(requestId, listResult)}}}, host);
      return;
    }

    if (result.kind === 'cancel') {
      this.requestClose(data, host);
      return;
    }

    const saveResult = host.config.saveDraft(result.draft);
    const nextState = saveResult.ok
      ? markModelConfigSaved({...result.state, draft: result.draft})
      : {...result.state, error: saveResult.error || '无法保存配置'};
    const general = saveResult.ok && data.general?.state
      ? {state: {...data.general.state, approvalModelProfiles: host.config.listApprovalModelProfiles()}}
      : data.general;
    this.update({...data, general, models: {state: nextState}}, host);
  }

  private requestClose(data: ConfigCommandData, host: CommandHost): void {
    // 子视图属于配置中心内部层级：先退回常规 Tab，再允许关闭整个配置中心。
    if (data.systemPrompt) {
      this.leaveSystemPromptView(data, host);
      return;
    }

    const dirtyTabs = [
      ...(isGeneralConfigDirty(data.general?.state) ? ['常规'] : []),
      ...(isModelConfigDirty(data.models?.state) ? ['模型与 Provider'] : []),
      ...(isToolsConfigDirty(data.tools?.state) ? ['工具'] : []),
      ...(isSandboxConfigDirty(data.sandbox?.state) ? ['沙箱'] : [])
    ];

    if (dirtyTabs.length > 0) {
      this.update({...data, discardConfirm: {dirtyTabs, selectedIndex: 0}}, host);
      return;
    }

    host.session.close();
  }

  private handleDiscardConfirm(data: ConfigCommandData, event: InputEvent, host: CommandHost): void {
    const confirm = data.discardConfirm;
    if (!confirm) {
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.update({...data, discardConfirm: undefined}, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.update({...data, discardConfirm: {...confirm, selectedIndex: clamp(confirm.selectedIndex + delta, 0, 1)}}, host);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      if (confirm.selectedIndex === 1) {
        host.session.close();
      } else {
        this.update({...data, discardConfirm: undefined}, host);
      }
    }
  }

  private update(data: ConfigCommandData, host: CommandHost): void {
    host.session.update({surface: createConfigSurface(data), data});
  }
}

function initializeTab(data: ConfigCommandData, tab: ConfigTabId, host: CommandHost): ConfigCommandData {
  if (tab === 'general' && !data.general) {
    try {
      const systemPrompt = host.config.readSystemPrompt();
      return {
        ...data,
        general: {
          state: createInitialGeneralConfigState(
            host.config.readSettings(),
            host.config.listApprovalModelProfiles(),
            systemPrompt.ok ? {kind: systemPrompt.snapshot.sourceKind} : {kind: 'unknown'}
          )
        }
      };
    } catch (error: unknown) {
      return {...data, general: {error: toErrorMessage(error)}};
    }
  }

  if (tab === 'models' && !data.models) {
    try {
      return {...data, models: {state: createInitialConfigState(host.config.readDraft())}};
    } catch (error: unknown) {
      return {...data, models: {error: toErrorMessage(error)}};
    }
  }

  if (tab === 'tools' && !data.tools) {
    try {
      return {...data, tools: {state: createInitialToolsConfigState(host.config.readToolsDraft(), host.config.listToolCatalog())}};
    } catch (error: unknown) {
      return {...data, tools: {error: toErrorMessage(error)}};
    }
  }

  if (tab === 'sandbox' && !data.sandbox) {
    try {
      return {...data, sandbox: {state: createInitialSandboxConfigState(host.config.readSandboxDraft())}};
    } catch (error: unknown) {
      return {...data, sandbox: {error: toErrorMessage(error)}};
    }
  }

  if (tab === 'appearance' && !data.appearance) {
    try {
      return {...data, appearance: {state: createInitialAppearanceConfigState(host.theme.listThemes())}};
    } catch (error: unknown) {
      return {...data, appearance: {error: toErrorMessage(error)}};
    }
  }

  return data;
}

/** 按选中行调整常规草稿；二选一策略在任一方向上切换，不触发持久化。 */
function adjustGeneralValue(state: GeneralConfigState, direction: number): GeneralConfigState {
  const selectedRow = getGeneralConfigRowIds(state)[state.selectedIndex];
  if (selectedRow === 'compactionThreshold') {
    const next = Math.round((state.draft.compactionThresholdRatio + direction * 0.05) * 100) / 100;
    state.draft.compactionThresholdRatio = clamp(next, 0.5, 0.95);
  } else if (selectedRow === 'skillCatalogRatio') {
    const next = Math.round((state.draft.skillCatalogContextRatio + direction * 0.01) * 100) / 100;
    state.draft.skillCatalogContextRatio = clamp(next, 0.01, 0.1);
  } else if (selectedRow === 'slashSuggestionLimit') {
    state.draft.slashSuggestionMaxVisible = clamp(state.draft.slashSuggestionMaxVisible + direction, 1, 20);
  } else if (selectedRow === 'reasoningSummary') {
    state.draft.showReasoningSummary = !state.draft.showReasoningSummary;
  } else if (selectedRow === 'historyRenderLineLimit') {
    const current = HISTORY_RENDER_LINE_LIMIT_OPTIONS.indexOf(state.draft.historyRenderLineLimit);
    const next = clamp(current + direction, 0, HISTORY_RENDER_LINE_LIMIT_OPTIONS.length - 1);
    state.draft.historyRenderLineLimit = HISTORY_RENDER_LINE_LIMIT_OPTIONS[next];
  } else if (selectedRow === 'mouseInteraction') {
    state.draft.mouseInteractionEnabled = !state.draft.mouseInteractionEnabled;
  } else if (selectedRow === 'defaultInteractionMode') {
    state.draft.defaultInteractionMode = state.draft.defaultInteractionMode === 'normal' ? 'plan' : 'normal';
  } else if (selectedRow === 'activeTurnMessagePolicy') {
    state.draft.activeTurnMessagePolicy = state.draft.activeTurnMessagePolicy === 'pending' ? 'steer' : 'pending';
  } else if (selectedRow === 'autoCompressImages') {
    state.draft.autoCompressImages = !state.draft.autoCompressImages;
  } else if (selectedRow === 'checkUpdatesOnStartup') {
    state.draft.checkUpdatesOnStartup = !state.draft.checkUpdatesOnStartup;
  } else if (selectedRow === 'toolApprovalMode') {
    state.draft.toolApprovalMode = state.draft.toolApprovalMode === 'manual' ? 'auto' : 'manual';
    if (state.draft.toolApprovalMode === 'auto'
      && !state.approvalModelProfiles.some((profile) => profile.id === state.draft.toolApprovalModelProfileId)) {
      state.draft.toolApprovalModelProfileId = state.approvalModelProfiles[0]?.id;
    }
  } else if (selectedRow === 'toolApprovalModel' && state.approvalModelProfiles.length > 0) {
    const current = state.approvalModelProfiles.findIndex((profile) => profile.id === state.draft.toolApprovalModelProfileId);
    const next = (Math.max(0, current) + direction + state.approvalModelProfiles.length) % state.approvalModelProfiles.length;
    state.draft.toolApprovalModelProfileId = state.approvalModelProfiles[next].id;
  } else if (selectedRow === 'titleModel') {
    // 单行表达三态：不生成、跟随当前模型、指定 profile；未选中的 profile 引用会保留以便切回。
    const options = [
      {enabled: false, profileId: state.draft.titleGenerationModelProfileId},
      {enabled: true, profileId: undefined},
      ...state.approvalModelProfiles.map((profile) => ({enabled: true, profileId: profile.id}))
    ];
    const current = options.findIndex((option) =>
      option.enabled === state.draft.titleGenerationEnabled
      && (!option.enabled || option.profileId === state.draft.titleGenerationModelProfileId)
    );
    const next = (Math.max(0, current) + direction + options.length) % options.length;
    state.draft.titleGenerationEnabled = options[next].enabled;
    state.draft.titleGenerationModelProfileId = options[next].profileId;
  } else if (selectedRow === 'instructionFile') {
    state.draft.agentInstructionFileName = state.draft.agentInstructionFileName === 'AGENTS.md' ? 'CLAUDE.md' : 'AGENTS.md';
  }
  return state;
}

const SANDBOX_PATH_INPUT_MAX = 4096; // 沙箱目录行内输入长度上限(码点);覆盖 PATH_MAX,防止超长粘贴撑爆缓冲。

function adjustSandboxValue(state: SandboxConfigState, direction: number): void {
  const selectedRow = getSandboxConfigRowIds(state)[state.selectedIndex];

  if (selectedRow === 'mode') {
    const currentIndex = SANDBOX_MODE_CYCLE.indexOf(state.draft.mode);
    const next = (Math.max(0, currentIndex) + direction + SANDBOX_MODE_CYCLE.length) % SANDBOX_MODE_CYCLE.length;
    state.draft.mode = SANDBOX_MODE_CYCLE[next];
  } else if (selectedRow === 'network') {
    state.draft.network = !state.draft.network;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  ConfigCommandHandler
};
