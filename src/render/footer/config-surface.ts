import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth} from '../layout';
import {activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme, type TuiTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {constrainLayoutTail, createSelectedWindowRows} from './window';
import {getProviderPreset, listProviderPresets, providerRequiresApiKey} from '../../config/provider-presets';
import type {AppearanceConfigState, ConfigCommandState, ConfigCommandSurface, ConfigFormRow, ConfigSurfaceTab, ConfigTabId, GeneralConfigState} from '../../types/command';
import type {FooterLayout} from '../../types/render';

type RenderConfigPanelOptions = {
  maxLines?: number;
  rows: ConfigFormRow[];
  theme?: TuiTheme;
};

type RenderConfigSurfaceOptions = {
  maxLines?: number;
  theme?: TuiTheme;
};

type ConfigListItem =
  | {kind: 'provider'; index: number}
  | {kind: 'add'}
  | {kind: 'save'};

/**
 * 渲染 /config footer surface；状态由 command handler 维护，renderer 只投影快照。
 */
function renderConfigSurface(commandSurface: ConfigCommandSurface, width: number, options: RenderConfigSurfaceOptions = {}): FooterLayout {
  const theme = resolveFooterTheme(options.theme);
  let lines: string[];

  if (commandSurface.view === 'general') {
    lines = renderGeneralView(commandSurface.state, commandSurface.tabs, commandSurface.activeTab, width, options.maxLines, theme);
  } else if (commandSurface.view === 'appearance') {
    lines = renderAppearanceView(commandSurface.state, commandSurface.tabs, commandSurface.activeTab, width, options.maxLines, theme);
  } else if (commandSurface.view === 'models') {
    const extraLines = 1 + (commandSurface.state.feedback ? 1 : 0);
    const modelLines = renderConfigPanel(commandSurface.state, width, {
      maxLines: Number.isFinite(options.maxLines) ? Math.max(1, Number(options.maxLines) - extraLines) : options.maxLines,
      rows: commandSurface.rows,
      theme: options.theme
    });
    const boxWidth = calculateBoxWidth(width);
    modelLines.splice(1, 0, renderTabsLine(boxWidth, commandSurface.tabs, commandSurface.activeTab, theme));
    if (commandSurface.state.feedback) {
      modelLines.splice(Math.max(1, modelLines.length - 2), 0, feedbackLine(boxWidth, commandSurface.state.feedback, theme));
    }
    lines = modelLines;
  } else if (commandSurface.view === 'error') {
    lines = renderConfigErrorView(commandSurface.error, commandSurface.tabs, commandSurface.activeTab, width, theme);
  } else if (commandSurface.view === 'discardConfirm') {
    lines = renderCenterDiscardConfirm(commandSurface.dirtyTabs, commandSurface.selectedIndex, commandSurface.tabs, commandSurface.activeTab, width, theme);
  } else {
    lines = [];
  }

  return constrainLayoutTail({
    lines,
    cursorRow: Math.max(0, lines.length - 1),
    cursorColumn: 0,
    showCursor: false
  }, options.maxLines);
}

/**
 * 渲染常规设置 Tab；数值只显示归一化草稿，状态转移由 command handler 负责。
 */
function renderGeneralView(state: GeneralConfigState, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, columns: number, maxLines: number | undefined, theme: FooterTheme): string[] {
  const width = calculateBoxWidth(columns);
  const rows = [
    {label: '自动压缩阈值', value: `${Math.round(state.draft.compactionThresholdRatio * 100)}%`},
    {label: '技能列表上下文占比上限', value: `${Math.round(state.draft.skillCatalogContextRatio * 100)}%`},
    {label: 'Slash 建议最多显示', value: `${state.draft.slashSuggestionMaxVisible} 条`},
    {label: '显示推理摘要', value: state.draft.showReasoningSummary ? '开' : '关'},
    {label: '默认启动模式', value: state.draft.defaultInteractionMode},
    {label: '保存常规设置', value: '写入 ~/.echo/config.json', action: true}
  ];
  const fixedLines = 5 + (state.error || state.feedback ? 1 : 0);
  const visibleRows = Number.isFinite(maxLines)
    ? createSelectedWindowRows(rows, state.selectedIndex, calculateItemBudget(maxLines, fixedLines))
    : rows.map((item, index) => ({kind: 'item' as const, item, index}));
  const lines = [top(width, ' CONFIG ', 'accentStrong', theme, ansi.dim('常规')), renderTabsLine(width, tabs, activeTab, theme)];

  for (const row of visibleRows) {
    if (row.kind === 'more') {
      lines.push(moreRow(width, row.direction, row.count, theme));
    } else if (row.item.action) {
      lines.push(actionRow(width, row.item.label, row.item.value, row.index === state.selectedIndex, false, theme));
    } else {
      lines.push(splitRow(width, row.item.label, row.item.value, row.index === state.selectedIndex, theme));
    }
  }

  if (state.error) {
    lines.push(errorLine(width, state.error, theme));
  } else if (state.feedback) {
    lines.push(feedbackLine(width, state.feedback, theme));
  }
  lines.push(line(width, dimHint(width, 'Tab 切换 · ↑/↓ 移动 · ←/→ 调整 · Enter 执行 · Esc 关闭'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function renderAppearanceView(state: AppearanceConfigState, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, columns: number, maxLines: number | undefined, theme: FooterTheme): string[] {
  const width = calculateBoxWidth(columns);
  const fixedLines = 5 + (state.error || state.feedback ? 1 : 0) + (state.themes.length === 0 ? 1 : 0);
  const visibleRows = Number.isFinite(maxLines)
    ? createSelectedWindowRows(state.themes, state.selectedIndex, calculateItemBudget(maxLines, fixedLines))
    : state.themes.map((item, index) => ({kind: 'item' as const, item, index}));
  const lines = [top(width, ' CONFIG ', 'accentStrong', theme, ansi.dim('外观')), renderTabsLine(width, tabs, activeTab, theme)];

  if (state.themes.length === 0) {
    lines.push(line(width, ansi.dim('当前没有可用的内置 theme。'), theme));
  }

  for (const row of visibleRows) {
    if (row.kind === 'more') {
      lines.push(moreRow(width, row.direction, row.count, theme));
    } else {
      const marker = row.item.selected ? tokenText(theme, 'success', '●') : tokenText(theme, 'muted', '○');
      lines.push(presetRow(width, `${marker} ${row.item.label}`, row.item.description, row.index === state.selectedIndex, theme));
    }
  }

  if (state.error) {
    lines.push(errorLine(width, state.error, theme));
  } else if (state.feedback) {
    lines.push(feedbackLine(width, state.feedback, theme));
  }
  lines.push(line(width, dimHint(width, 'Tab 切换 · ↑/↓ 移动 · Enter 应用主题 · Esc 关闭'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function renderConfigErrorView(error: string, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, columns: number, theme: FooterTheme): string[] {
  const width = calculateBoxWidth(columns);
  return [
    top(width, ' CONFIG ', 'accentStrong', theme, ansi.dim('错误')),
    renderTabsLine(width, tabs, activeTab, theme),
    line(width, '', theme),
    errorLine(width, error, theme),
    line(width, '', theme),
    line(width, dimHint(width, 'Tab 切换 · Esc 关闭'), theme),
    bottom(width, theme)
  ];
}

function renderCenterDiscardConfirm(dirtyTabs: string[], selectedIndex: number, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, columns: number, theme: FooterTheme): string[] {
  const width = calculateBoxWidth(columns);
  return [
    top(width, ' CONFIG ', 'warning', theme, ansi.dim('未保存的更改')),
    renderTabsLine(width, tabs, activeTab, theme),
    line(width, ansi.dim(`未保存：${dirtyTabs.join('、')}`), theme),
    actionRow(width, '继续编辑', '返回配置中心', selectedIndex === 0, false, theme),
    actionRow(width, '放弃更改', '关闭 /config', selectedIndex === 1, true, theme),
    line(width, dimHint(width, '↑/↓ 移动 · Enter 确认 · Esc 返回'), theme),
    bottom(width, theme)
  ];
}

function renderTabsLine(width: number, tabs: ConfigSurfaceTab[], activeTab: ConfigTabId, theme: FooterTheme): string {
  const text = tabs.map((tab) => {
    const marker = tab.status === 'dirty' ? '● ' : tab.status === 'error' ? '! ' : '';
    const label = `[${marker}${tab.label}]`;
    return tab.id === activeTab
      ? tokenText(theme, 'accentStrong', ansi.bold(label))
      : tokenText(theme, tab.status === 'error' ? 'warning' : 'muted', label);
  }).join(' ');
  return line(width, clampInnerText(text, contentWidth(width)), theme);
}

function errorLine(width: number, error: string, theme: FooterTheme): string {
  return line(width, ` ${tokenText(theme, 'danger', '▌')} ${ansi.dim(clampPlainText(error, width - 6))}`, theme);
}

function feedbackLine(width: number, feedback: string, theme: FooterTheme): string {
  return line(width, ` ${tokenText(theme, 'success', clampPlainText(feedback, width - 5))}`, theme);
}

function renderConfigPanel(state: ConfigCommandState, columns: number, options: RenderConfigPanelOptions): string[] {
  const theme = resolveFooterTheme(options.theme);
  const width = calculateBoxWidth(columns);

  if (state.mode === 'preset') {
    return renderPresetView(state, width, options.maxLines, theme);
  }
  if (state.mode === 'modelList') {
    return renderModelListView(state, width, options.maxLines, theme);
  }
  if (state.mode === 'form') {
    return renderFormView(state, width, options.rows, options.maxLines, theme);
  }
  if (state.mode === 'headerList') {
    return renderHeaderListView(state, width, options.maxLines, theme);
  }
  if (state.mode === 'headerDetail') {
    return renderHeaderDetailView(state, width, theme);
  }
  if (state.mode === 'modelDetail') {
    return renderModelDetailView(state, width, theme);
  }
  return renderListView(state, width, options.maxLines, theme);
}

function calculateBoxWidth(columns: number): number {
  const safeWidth = safeRenderWidth(columns || 80);
  return Math.max(4, Math.min(92, safeWidth - 4 > 0 ? safeWidth - 4 : safeWidth));
}

function renderListView(state: ConfigCommandState, width: number, maxLines: number | undefined, theme: FooterTheme): string[] {
  const status = state.error
    ? tokenText(theme, 'danger', '错误')
    : state.draft.providers.length > 0
      ? ansi.dim('草稿')
      : ansi.dim('空');
  const lines = [top(width, ' PROVIDERS ', 'accentStrong', theme, status), line(width, '', theme)];
  const items = createListItems(state);
  const fixedLineCount = 5 + (state.error ? 2 : 0) + (state.draft.providers.length === 0 ? 1 : 0);
  const visibleRows = Number.isFinite(maxLines) && items.length + fixedLineCount > Number(maxLines)
    ? createSelectedWindowRows(items, state.providerIndex, calculateItemBudget(maxLines, fixedLineCount))
    : items.map((item, index) => ({kind: 'item' as const, item, index}));

  if (state.draft.providers.length === 0) {
    lines.push(line(width, `  ${ansi.dim('还没有 provider，请选择“新增 provider”')}`, theme));
  }

  for (const row of visibleRows) {
    if (row.kind === 'more') {
      lines.push(moreRow(width, row.direction, row.count, theme));
    } else {
      lines.push(renderListItemRow(width, state, row.item, theme));
    }
  }

  appendError(lines, state, width, theme);
  lines.push(line(width, '', theme));
  lines.push(line(width, dimHint(width, '↑/↓ 移动 · Enter 打开/新增/保存 · d 删除 · Esc 取消'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function createListItems(state: ConfigCommandState): ConfigListItem[] {
  return [
    ...state.draft.providers.map((_provider, index) => ({kind: 'provider' as const, index})),
    {kind: 'add'},
    {kind: 'save'}
  ];
}

function renderListItemRow(width: number, state: ConfigCommandState, item: ConfigListItem, theme: FooterTheme): string {
  if (item.kind === 'provider') {
    const provider = state.draft.providers[item.index];
    const preset = getProviderPreset(provider.preset);
    const hasCredential = preset ? !providerRequiresApiKey(preset) || provider.apiKey !== '' : provider.apiKey !== '';
    return providerRow(width, provider.label || provider.id, hasCredential, provider.models.length, item.index === state.providerIndex, theme);
  }

  if (item.kind === 'add') {
    return actionRow(width, '+ 新增 provider', '创建 provider 配置', state.providerIndex === state.draft.providers.length, false, theme);
  }

  return actionRow(width, '保存更改', '写入 ~/.echo/config.json', state.providerIndex === state.draft.providers.length + 1, false, theme);
}

function providerRow(width: number, nameText: string, hasKey: boolean, modelCount: number, active: boolean, theme: FooterTheme): string {
  const inner = contentWidth(width);
  const key = hasKey ? tokenText(theme, 'success', '●') : tokenText(theme, 'muted', '○');
  const name = tokenText(theme, active ? 'accentStrong' : 'accent', active ? ansi.bold(nameText) : nameText);
  const right = ansi.dim(`${modelCount} 个 model`);
  const bodyWidth = activeBodyWidth(inner, active);
  const left = `${active ? ' ' : '  '}${key} ${name}`;
  const body = padVisibleText(left, bodyWidth - displayWidth(right)) + right;
  return line(width, renderSelectableBody(inner, body, active, theme), theme);
}

function renderFormView(state: ConfigCommandState, width: number, rows: ConfigFormRow[], maxLines: number | undefined, theme: FooterTheme): string[] {
  const provider = state.draft.providers[state.providerIndex];
  const title = ` ${provider?.label || '新 provider'} `;
  const fullLines = [
    top(width, title, 'accentStrong', theme, ansi.dim('provider')),
    line(width, '', theme),
    sectionLine(width, '连接信息', theme)
  ];

  rows.forEach((row, rowIndex) => {
    if (row.kind === 'preset' || row.kind === 'field' || row.kind === 'headers') {
      fullLines.push(renderFormSelectableRow(state, width, row, rowIndex, theme));
    }
  });

  fullLines.push(line(width, '', theme));
  fullLines.push(sectionLine(width, `模型 (${provider?.models.length || 0})`, theme));
  rows.forEach((row, rowIndex) => {
    if (row.kind === 'model' || row.kind === 'addModel' || row.kind === 'listModels') {
      fullLines.push(renderFormSelectableRow(state, width, row, rowIndex, theme));
    }
  });

  fullLines.push(dividerLine(width, theme));
  rows.forEach((row, rowIndex) => {
    if (row.kind === 'deleteProvider' || row.kind === 'save') {
      fullLines.push(renderFormSelectableRow(state, width, row, rowIndex, theme));
    }
  });

  appendError(fullLines, state, width, theme);
  fullLines.push(line(width, '', theme));
  fullLines.push(line(width, dimHint(width, '↑/↓ 移动 · Enter 打开/编辑 · s 设为默认 · d 删除 · Esc 返回'), theme));
  fullLines.push(bottom(width, theme));

  if (!Number.isFinite(maxLines) || fullLines.length <= Number(maxLines)) {
    return fullLines;
  }

  const lines = [top(width, title, 'accentStrong', theme, ansi.dim('provider')), line(width, '', theme)];
  const visibleRows = createSelectedWindowRows(rows, state.formIndex, calculateItemBudget(maxLines, 5 + (state.error ? 2 : 0)));

  for (const row of visibleRows) {
    if (row.kind === 'more') {
      lines.push(moreRow(width, row.direction, row.count, theme));
    } else {
      lines.push(renderFormSelectableRow(state, width, row.item, row.index, theme));
    }
  }

  appendError(lines, state, width, theme);
  lines.push(line(width, '', theme));
  lines.push(line(width, dimHint(width, '↑/↓ 移动 · Enter 打开/编辑 · s 默认 · d 删除 · Esc 返回'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function renderFormSelectableRow(state: ConfigCommandState, width: number, row: ConfigFormRow, rowIndex: number, theme: FooterTheme): string {
  const provider = state.draft.providers[state.providerIndex];
  const active = rowIndex === state.formIndex;

  if (row.kind === 'preset') {
    const preset = provider ? getProviderPreset(provider.preset) : undefined;
    return kvRow(width, 'Provider 类型', preset?.label || provider?.preset || '未设置', active, theme);
  }

  if (row.kind === 'field') {
    return fieldRow(width, state, row, active, theme);
  }

  if (row.kind === 'headers') {
    const userCount = Object.keys(provider?.headers || {}).length;
    const presetCount = Object.keys(getProviderPreset(provider?.preset || '')?.headers || {}).length;
    const value = presetCount > 0 ? `${userCount} 个自定义 · ${presetCount} 个内置` : `${userCount} 个自定义`;
    return kvRow(width, '自定义 headers', value, active, theme);
  }

  if (row.kind === 'model') {
    const model = provider?.models[row.modelIndex];
    const selected = model?.id === state.draft.selectedModelId;
    const marker = selected ? tokenText(theme, 'success', '●') : tokenText(theme, 'muted', '○');
    const context = model?.contextWindow ? `ctx ${formatInteger(model.contextWindow)}` : 'ctx 自动';
    return splitRow(width, `${marker} ${model?.model || '未设置'}`, context, active, theme);
  }

  if (row.kind === 'addModel') {
    return actionRow(width, '+ 新增 model', '创建 model 配置', active, false, theme);
  }
  if (row.kind === 'listModels') {
    return actionRow(width, '获取 model 列表', '从 provider 获取', active, false, theme);
  }
  if (row.kind === 'deleteProvider') {
    return actionRow(width, '删除 provider', '从草稿移除', active, true, theme);
  }
  return actionRow(width, '保存更改', '写入 ~/.echo/config.json', active, false, theme);
}

function fieldRow(width: number, state: ConfigCommandState, row: Extract<ConfigFormRow, {kind: 'field'}>, active: boolean, theme: FooterTheme): string {
  const provider = state.draft.providers[state.providerIndex];
  const preset = provider ? getProviderPreset(provider.preset) : undefined;
  const label = row.field === 'label'
    ? '名称'
    : row.field === 'apiKey'
      ? 'API key'
      : row.field === 'baseURL'
        ? 'Base URL'
        : 'Codex auth.json';
  const editing = state.editTarget?.kind === 'field' && state.editTarget.field === row.field;
  let value: string;

  if (editing) {
    value = `${row.field === 'apiKey' ? '•'.repeat(state.editBuffer.length) : state.editBuffer}█`;
  } else if (row.field === 'label') {
    value = provider?.label || '';
  } else if (row.field === 'apiKey') {
    value = provider?.apiKey ? '•'.repeat(Math.min(provider.apiKey.length, 16)) : '未设置';
  } else if (row.field === 'codexAuthFile') {
    value = provider?.codexAuthFile || '~/.codex/auth.json';
  } else if (preset?.baseURLMode === 'fixed') {
    value = preset.baseURL || '内置';
  } else {
    value = provider?.baseURL || '未设置';
  }

  return kvRow(width, label, value, active, theme);
}

function renderHeaderListView(state: ConfigCommandState, width: number, maxLines: number | undefined, theme: FooterTheme): string[] {
  const provider = state.draft.providers[state.providerIndex];
  const headers = Object.entries(provider?.headers || {});
  const items = [...headers.map(([name]) => ({kind: 'header' as const, name})), {kind: 'add' as const}];
  const lines = [top(width, ' 自定义 HEADERS ', 'accentStrong', theme, ansi.dim(provider?.label || 'provider')), line(width, '', theme)];
  const presetCount = Object.keys(getProviderPreset(provider?.preset || '')?.headers || {}).length;

  if (presetCount > 0) {
    lines.push(line(width, ` ${ansi.dim(`${presetCount} 个 header 由 provider 类型管理，值不会显示`)}`, theme));
  }
  if (headers.length === 0) {
    lines.push(line(width, ` ${ansi.dim('还没有自定义 header')}`, theme));
  }

  const fixed = 5 + (presetCount > 0 ? 1 : 0) + (headers.length === 0 ? 1 : 0);
  const visibleRows = Number.isFinite(maxLines)
    ? createSelectedWindowRows(items, state.headerIndex, calculateItemBudget(maxLines, fixed))
    : items.map((item, index) => ({kind: 'item' as const, item, index}));

  for (const row of visibleRows) {
    if (row.kind === 'more') {
      lines.push(moreRow(width, row.direction, row.count, theme));
    } else if (row.item.kind === 'header') {
      lines.push(splitRow(width, row.item.name, '••••••••', row.index === state.headerIndex, theme));
    } else {
      lines.push(actionRow(width, '+ 新增 header', '添加自定义请求 header', row.index === state.headerIndex, false, theme));
    }
  }

  appendError(lines, state, width, theme);
  lines.push(line(width, '', theme));
  lines.push(line(width, dimHint(width, '↑/↓ 移动 · Enter 打开/新增 · Esc 返回'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function renderHeaderDetailView(state: ConfigCommandState, width: number, theme: FooterTheme): string[] {
  const editor = state.headerEditor;
  const saveIndex = editor?.isNew ? 2 : 3;
  const lines = [
    top(width, editor?.isNew ? ' 新增 HEADER ' : ' 编辑 HEADER ', 'accentStrong', theme),
    line(width, '', theme)
  ];
  const name = state.editTarget?.kind === 'headerName' ? `${state.editBuffer}█` : editor?.name || '未设置';
  const value = state.editTarget?.kind === 'headerValue'
    ? `${'•'.repeat(state.editBuffer.length)}█`
    : editor?.value || editor?.existingValue
      ? '••••••••'
      : '未设置';

  lines.push(kvRow(width, '名称', name, state.headerDetailIndex === 0, theme));
  lines.push(kvRow(width, '值', value, state.headerDetailIndex === 1, theme));
  if (!editor?.isNew) {
    lines.push(actionRow(width, '删除 header', '从 provider 草稿移除', state.headerDetailIndex === 2, true, theme));
  }
  lines.push(actionRow(width, '保存 header', '更新当前草稿', state.headerDetailIndex === saveIndex, false, theme));
  appendError(lines, state, width, theme);
  lines.push(line(width, '', theme));
  lines.push(line(width, dimHint(width, '↑/↓ 移动 · Enter 编辑/确认 · Esc 返回'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function renderModelDetailView(state: ConfigCommandState, width: number, theme: FooterTheme): string[] {
  const provider = state.draft.providers[state.providerIndex];
  const model = provider?.models[state.modelIndex];
  const title = ` ${model?.model || '新 model'} `;
  const lines = [top(width, title, 'accentStrong', theme, ansi.dim('model')), line(width, '', theme)];
  const modelName = state.editTarget?.kind === 'modelName' ? `${state.editBuffer}█` : model?.model || '未设置';
  const contextWindow = state.editTarget?.kind === 'contextWindow'
    ? `${state.editBuffer}█`
    : model?.contextWindow
      ? formatInteger(model.contextWindow)
      : '自动';

  lines.push(kvRow(width, 'Model API id', modelName, state.modelDetailIndex === 0, theme));
  lines.push(kvRow(width, 'Context window', contextWindow, state.modelDetailIndex === 1, theme));
  lines.push(actionRow(
    width,
    model?.id === state.draft.selectedModelId ? '当前默认 model' : '设为默认 model',
    model?.id === state.draft.selectedModelId ? '已选择' : '后续请求使用',
    state.modelDetailIndex === 2,
    false,
    theme
  ));
  lines.push(actionRow(width, '删除 model', '从 provider 草稿移除', state.modelDetailIndex === 3, true, theme));
  appendError(lines, state, width, theme);
  lines.push(line(width, '', theme));
  lines.push(line(width, dimHint(width, '↑/↓ 移动 · Enter 编辑/执行 · Esc 返回'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function renderModelListView(state: ConfigCommandState, width: number, maxLines: number | undefined, theme: FooterTheme): string[] {
  const modelList = state.modelList;
  const statusText = modelList?.status === 'loading'
    ? '加载中'
    : modelList?.status === 'ready'
      ? '可选择'
      : modelList?.status === 'empty'
        ? '空'
        : modelList?.status === 'unsupported'
          ? '不支持'
          : modelList?.status === 'error'
            ? '错误'
            : 'models';
  const lines = [top(width, ' 可用 MODELS ', 'accentStrong', theme, ansi.dim(statusText)), line(width, '', theme)];

  if (!modelList || modelList.status === 'loading') {
    lines.push(line(width, ` ${ansi.dim('正在从 provider 获取 models...')}`, theme));
  } else if (modelList.status === 'ready') {
    const visibleRows = Number.isFinite(maxLines)
      ? createSelectedWindowRows(modelList.models, modelList.selectedIndex, calculateItemBudget(maxLines, 5 + (modelList.truncated ? 1 : 0)))
      : modelList.models.map((model, index) => ({kind: 'item' as const, item: model, index}));

    for (const row of visibleRows) {
      if (row.kind === 'more') {
        lines.push(moreRow(width, row.direction, row.count, theme));
      } else {
        lines.push(modelRow(width, clampInnerText(row.item.id, contentWidth(width) - 2), row.index === modelList.selectedIndex, theme));
      }
    }

    if (modelList.truncated) {
      lines.push(line(width, ` ${ansi.dim(clampInnerText('仅显示前 100 个 models', contentWidth(width) - 1))}`, theme));
    }
  } else if (modelList.status === 'empty') {
    lines.push(line(width, ` ${ansi.dim('provider 未返回 models')}`, theme));
  } else {
    lines.push(line(width, ` ${tokenText(theme, 'danger', '▌')} ${ansi.dim(clampPlainText(modelList.error || '无法列出模型', width - 6))}`, theme));
  }

  lines.push(line(width, '', theme));
  lines.push(line(width, dimHint(width, modelList?.status === 'ready' ? '↑/↓ 移动 · Enter 添加 model · Esc 返回' : 'Enter/Esc 返回'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function renderPresetView(state: ConfigCommandState, width: number, maxLines: number | undefined, theme: FooterTheme): string[] {
  const presets = listProviderPresets();
  const lines = [top(width, ' PROVIDER 类型 ', 'accentStrong', theme, ansi.dim('选择')), line(width, '', theme)];
  const visibleRows = Number.isFinite(maxLines)
    ? createSelectedWindowRows(presets, state.presetIndex, calculateItemBudget(maxLines, 5))
    : presets.map((preset, index) => ({kind: 'item' as const, item: preset, index}));

  for (const row of visibleRows) {
    if (row.kind === 'more') {
      lines.push(moreRow(width, row.direction, row.count, theme));
      continue;
    }

    lines.push(presetRow(width, row.item.label, row.item.description, row.index === state.presetIndex, theme));
  }

  lines.push(line(width, '', theme));
  lines.push(line(width, dimHint(width, '↑/↓ 移动 · Enter 选择 · Esc 返回'), theme));
  lines.push(bottom(width, theme));
  return lines;
}

function appendError(lines: string[], state: ConfigCommandState, width: number, theme: FooterTheme): void {
  if (!state.error) {
    return;
  }

  lines.push(line(width, '', theme));
  lines.push(line(width, ` ${tokenText(theme, 'danger', '▌')} ${ansi.dim(clampPlainText(state.error, width - 6))}`, theme));
}

function moreRow(width: number, direction: 'up' | 'down', count: number, theme: FooterTheme): string {
  return line(width, `  ${ansi.dim(`${direction === 'up' ? '↑' : '↓'} ${count} 更多`)}`, theme);
}

function calculateItemBudget(maxLines: number | undefined, fixedLines: number): number {
  if (!Number.isFinite(maxLines)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, Math.floor(Number(maxLines)) - fixedLines);
}

function kvRow(width: number, key: string, rawValue: string, active: boolean, theme: FooterTheme): string {
  return splitRow(width, key, rawValue || '未设置', active, theme);
}

function splitRow(width: number, leftText: string, rightText: string, active: boolean, theme: FooterTheme): string {
  const inner = contentWidth(width);
  const bodyWidth = activeBodyWidth(inner, active);
  const left = `${active ? ' ' : '  '}${tokenText(theme, active ? 'accentStrong' : 'accent', active ? ansi.bold(leftText) : leftText)}`;
  const right = tokenText(theme, active ? 'accentStrong' : 'accent', rightText);
  const rightWidth = Math.min(displayWidth(right), Math.max(0, Math.floor(bodyWidth * 0.48)));
  const body = `${padVisibleText(clampInnerText(left, bodyWidth - rightWidth), bodyWidth - rightWidth)}${padVisibleText(clampInnerText(right, rightWidth), rightWidth)}`;
  return line(width, renderSelectableBody(inner, body, active, theme), theme);
}

function modelRow(width: number, text: string, active: boolean, theme: FooterTheme): string {
  const inner = contentWidth(width);
  const body = `${active ? ' ' : '  '}${tokenText(theme, active ? 'accentStrong' : 'accent', text)}`;
  return line(width, renderSelectableBody(inner, body, active, theme), theme);
}

function presetRow(width: number, labelText: string, descriptionText: string, active: boolean, theme: FooterTheme): string {
  const inner = contentWidth(width);
  const bodyWidth = activeBodyWidth(inner, active);
  const prefix = active ? ' ' : '  ';
  const available = Math.max(1, bodyWidth - displayWidth(prefix));
  const labelWidth = Math.min(displayWidth(labelText), available);
  const descriptionWidth = Math.max(0, available - labelWidth);
  const label = clampInnerText(labelText, labelWidth);
  const description = descriptionWidth > 0 ? clampInnerText(` ${descriptionText}`, descriptionWidth) : '';
  const body = `${prefix}${tokenText(theme, active ? 'accentStrong' : 'accent', active ? ansi.bold(label) : label)}${ansi.dim(description)}`;
  return line(width, renderSelectableBody(inner, body, active, theme), theme);
}

function actionRow(width: number, labelText: string, hint: string, active: boolean, danger: boolean, theme: FooterTheme): string {
  const inner = contentWidth(width);
  const bodyWidth = activeBodyWidth(inner, active);
  const prefix = active ? ' ' : '  ';
  const rightWidth = Math.min(displayWidth(hint), Math.max(0, Math.floor(bodyWidth * 0.45)));
  const leftWidth = Math.max(1, bodyWidth - rightWidth);
  const labelTextVisible = clampInnerText(labelText, Math.max(1, leftWidth - 2));
  const token = danger ? 'danger' : active ? 'success' : 'accent';
  const label = tokenText(theme, token, active ? ansi.bold(labelTextVisible) : labelTextVisible);
  const left = `${prefix}${label}`;
  const right = rightWidth > 0 ? ansi.dim(clampInnerText(hint, rightWidth)) : '';
  const body = `${padVisibleText(left, leftWidth)}${padVisibleText(right, rightWidth)}`;
  return line(width, renderSelectableBody(inner, body, active, theme), theme);
}

function activeBodyWidth(inner: number, active: boolean): number {
  return Math.max(0, inner - (active ? 1 : 0));
}

function renderSelectableBody(inner: number, body: string, active: boolean, theme: FooterTheme): string {
  if (!active) {
    return body;
  }

  return `${renderFocusBar(theme)}${activeBackground(theme, padVisibleText(body, activeBodyWidth(inner, true)))}`;
}

function dimHint(width: number, text: string): string {
  return ansi.dim(clampInnerText(text, contentWidth(width)));
}

function clampInnerText(text: string, width: number): string {
  return clampPlainText(text, width + 1);
}

function sectionLine(width: number, text: string, theme: FooterTheme): string {
  const label = tokenText(theme, 'accentDeep', ansi.bold(text));
  const rail = tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, contentWidth(width) - displayWidth(label) - 1)));
  return line(width, `${label} ${rail}`, theme);
}

// 在 form 内分隔“provider 终态动作（删除 / 保存）”与上方 model 区，避免视觉粘连
function dividerLine(width: number, theme: FooterTheme): string {
  const rail = tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, contentWidth(width))));
  return line(width, rail, theme);
}

function top(width: number, title: string, token: keyof FooterTheme['colors'], theme: FooterTheme, right = ''): string {
  const inner = Math.max(0, width - 2);
  const suffix = right && displayWidth(` ${right} `) < inner ? ` ${right} ` : '';
  const titleWidth = Math.max(0, inner - displayWidth(suffix));
  const tag = titleWidth > 0 ? tokenText(theme, token, ansi.bold(clampPlainText(title, titleWidth))) : '';
  const rail = tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, inner - displayWidth(tag) - displayWidth(suffix))));
  return `${tokenText(theme, 'accentDeep', '╭')}${tag}${rail}${suffix}${tokenText(theme, 'accentDeep', '╮')}`;
}

function bottom(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width - 2)))}${tokenText(theme, 'accentDeep', '╯')}`;
}

function line(width: number, content: string, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '│')} ${padVisibleText(content, contentWidth(width))} ${tokenText(theme, 'accentDeep', '│')}`;
}

function contentWidth(width: number): number {
  return Math.max(0, width - 4);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export {
  renderConfigSurface
};
