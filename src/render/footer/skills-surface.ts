import * as ansi from '../../terminal/ansi';
import { displayWidth, safeRenderWidth } from '../layout';
import { activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme } from '../colors';
import { clampPlainText, padVisibleText } from './text';
import type { CommandSkillSurfaceInfo, SkillsCommandActiveField, SkillsCommandSurface } from '../../types/command';
import type { FooterLayout } from '../../types/render';

const WIDE_BOX_HORIZONTAL_MARGIN = 4;
const SKILLS_MAX_VISIBLE = 8;
const MODEL_LABEL_MAX_WIDTH = 32;
const EFFORT_LABEL_MAX_WIDTH = 12;
const DEFAULT_EFFORT_LABEL = '模型默认';

/**
 * 渲染 skills 管理面板；renderer 只投影 session 快照，启停和模型策略保存由命令 handler 完成。
 */
export function renderSkillsSurface(commandSurface: SkillsCommandSurface, width: number, theme: FooterTheme = resolveFooterTheme(undefined)): FooterLayout {
  const skills = commandSurface.skills;
  const selectedIndex = clampIndex(commandSurface.selectedIndex, skills.length);
  const boxWidth = calculateSkillsBoxWidth(width);
  const contentWidth = Math.max(1, boxWidth - 4);
  const lines = [
    renderTop(boxWidth, commandSurface.title, skills, theme),
    renderLine('', contentWidth, theme),
    ...renderSkillContent(commandSurface, selectedIndex, contentWidth, theme),
    renderLine('', contentWidth, theme),
    renderLine(ansi.dim(clampPlainText(commandSurface.dismissHint, contentWidth)), contentWidth, theme),
    renderBottom(boxWidth, theme)
  ];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 根据当前终端宽度计算 card 宽度，保守避开终端最后一列自动换行。
 */
function calculateSkillsBoxWidth(width: number): number {
  const safeWidth = Math.max(1, safeRenderWidth(width));

  if (safeWidth >= 64) {
    return Math.max(4, safeWidth - WIDE_BOX_HORIZONTAL_MARGIN);
  }

  return safeWidth;
}

/**
 * 渲染空状态或包含当前选中项的 skill 窗口。
 */
function renderSkillContent(commandSurface: SkillsCommandSurface, selectedIndex: number, contentWidth: number, theme: FooterTheme): string[] {
  const skills = commandSurface.skills;

  if (skills.length === 0) {
    const lines = commandSurface.emptyLines && commandSurface.emptyLines.length > 0
      ? commandSurface.emptyLines
      : ['当前没有发现可用 skill。'];
    return lines.map((line) => renderLine(ansi.dim(clampPlainText(line, contentWidth)), contentWidth, theme));
  }

  const start = Math.min(Math.max(0, selectedIndex - Math.floor(SKILLS_MAX_VISIBLE / 2)), Math.max(0, skills.length - SKILLS_MAX_VISIBLE));
  const end = Math.min(skills.length, start + SKILLS_MAX_VISIBLE);
  const rows: string[] = [];

  if (start > 0) {
    rows.push(renderLine(ansi.dim(`  ↑ ${start} 更多`), contentWidth, theme));
  }

  for (let index = start; index < end; index += 1) {
    rows.push(renderSkillRow(skills[index], index === selectedIndex, commandSurface.activeField || 'model', contentWidth, theme));
  }

  if (end < skills.length) {
    rows.push(renderLine(ansi.dim(`  ↓ ${skills.length - end} 更多`), contentWidth, theme));
  }

  return rows;
}

/**
 * 渲染单个 skill 行，选中态使用左侧 accent 和柔和背景强调。
 */
function renderSkillRow(skill: CommandSkillSurfaceInfo, active: boolean, activeField: SkillsCommandActiveField, contentWidth: number, theme: FooterTheme): string {
  const rowContentWidth = Math.max(1, contentWidth - 1);
  const pill = renderPill(skill.enabled, theme);
  const nameToken = active ? 'accentStrong' : skill.enabled ? 'accent' : 'muted';
  const textBudget = Math.max(3, rowContentWidth - displayWidth(` ${pill}  `));
  const contentBudget = Math.max(3, textBudget - 4);
  const nameBudget = Math.max(1, Math.min(24, Math.floor(contentBudget * 0.36)));
  const policyBudget = Math.max(2, contentBudget - nameBudget);
  const effortRatio = activeField === 'effort' ? 0.55 : 0.35;
  const effortBudget = Math.max(1, Math.min(EFFORT_LABEL_MAX_WIDTH, Math.floor(policyBudget * effortRatio)));
  const modelBudget = Math.max(1, Math.min(MODEL_LABEL_MAX_WIDTH, policyBudget - effortBudget));
  const nameText = clampPlainText(skill.name, nameBudget);
  const name = `${tokenText(theme, nameToken, active ? ansi.bold(nameText) : nameText)}`;
  const model = renderPolicyValue(skill.modelLabel, modelBudget, Boolean(skill.modelProfileId), active && activeField === 'model', theme);
  const effort = renderPolicyValue(skill.reasoningEffortOverride ?? DEFAULT_EFFORT_LABEL, effortBudget, skill.reasoningEffortOverride !== undefined, active && activeField === 'effort', theme);
  const description = `${skill.sourceKind} · ${skill.description}`;
  const prefix = `${pill}  ${model}  ${effort}  ${name}`;
  const descriptionWidth = rowContentWidth - displayWidth(` ${prefix}  `);
  const renderedDescription = descriptionWidth > 0 ? `  ${ansi.dim(clampPlainText(description, descriptionWidth))}` : '';
  const body = padVisibleText(` ${prefix}${renderedDescription}`, rowContentWidth);

  if (!active) {
    return renderLine(` ${body}`, contentWidth, theme);
  }

  const accent = renderFocusBar(theme);
  const activeBody = activeBackground(theme, body);
  return renderLine(`${accent}${activeBody}`, contentWidth, theme);
}

/**
 * 渲染 skill 行内策略值；选中行的活动字段使用更强样式，缺省动态策略保持弱化。
 */
function renderPolicyValue(label: string, width: number, fixed: boolean, focused: boolean, theme: FooterTheme): string {
  if (focused) {
    const text = width >= 3
      ? `‹${clampPlainText(label, width - 2)}›`
      : clampPlainText(label, width);
    return tokenText(theme, 'accentStrong', ansi.bold(text));
  }

  const text = clampPlainText(label, width);
  return tokenText(theme, fixed ? 'accent' : 'muted', text);
}

/**
 * 渲染固定宽度的开关 pill，使名称列保持对齐。
 */
function renderPill(enabled: boolean, theme: FooterTheme): string {
  if (enabled) {
    return tokenText(theme, 'success', `${ansi.bold('●')} 启用`);
  }

  return tokenText(theme, 'off', '○ 停用');
}

/**
 * 渲染顶部边框，并在右侧显示 enabled 计数。
 */
function renderTop(width: number, title: string, skills: CommandSkillSurfaceInfo[], theme: FooterTheme): string {
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const counter = skills.length > 0 ? ` ${tokenText(theme, 'success', ansi.bold(String(enabledCount)))}${ansi.dim(`/${skills.length} 启用`)} ` : '';
  const titleText = clampPlainText(title, Math.max(1, width - 2 - displayWidth(counter) - 2));
  const titleTag = tokenText(theme, 'accentStrong', ansi.bold(` ${titleText} `));
  const railWidth = Math.max(0, width - 2 - displayWidth(titleTag) - displayWidth(counter));

  return `${tokenText(theme, 'accentDeep', '╭')}${titleTag}${renderRail(railWidth, theme)}${counter}${tokenText(theme, 'accentDeep', '╮')}`;
}

/**
 * 渲染底部边框。
 */
function renderBottom(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${renderRail(Math.max(0, width - 2), theme)}${tokenText(theme, 'accentDeep', '╯')}`;
}

/**
 * 渲染面板内容行，按可见宽度补齐以保持右边框稳定。
 */
function renderLine(content: string, width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '│')} ${padVisibleText(content, width)} ${tokenText(theme, 'accentDeep', '│')}`;
}

/**
 * 渲染 cyan 横线，保持面板视觉与其它 neon 控件一致。
 */
function renderRail(width: number, theme: FooterTheme): string {
  return tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width)));
}

/**
 * 将 selectedIndex 收敛到 skills 数组范围内。
 */
function clampIndex(selectedIndex: number | undefined, count: number): number {
  if (count <= 0) {
    return 0;
  }

  return Math.min(Math.max(Number.isInteger(selectedIndex) ? selectedIndex || 0 : 0, 0), count - 1);
}
