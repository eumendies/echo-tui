/**
 * 启动 banner 渲染：大字标题、紧凑 box、BTW 变体与宽度收缩。
 */
import * as ansi from '../../terminal/ansi';
import {blockText} from '../colors';
import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {displayWidth, safeRenderWidth} from '../layout';
import {clampToDisplayWidth, padToDisplayWidth, type TextStyle} from './symbol-message-renderer';

import type {BannerContext, TerminalSize} from '../../types/render';

type BannerRenderContext = Partial<Omit<BannerContext, 'terminalSize'>> & {
  terminalSize?: TerminalSize;
};

// const TITLE_ART = [
//   ' ______ _____ _    _  ____  ',
//   '|  ____/ ____| |  | |/ __ \\ ',
//   '| |__ | |    | |__| | |  | |',
//   '|  __|| |    |  __  | |  | |',
//   '| |___| |____| |  | | |__| |',
//   '|______\\_____|_|  |_|\\____/'
// ];
const TITLE_ART = ['███████╗ ██████╗██╗  ██╗ ██████╗',  
                   '██╔════╝██╔════╝██║  ██║██╔═══██╗',  
                   '█████╗  ██║     ███████║██║   ██║',  
                   '██╔══╝  ██║     ██╔══██║██║   ██║',
                   '███████╗╚██████╗██║  ██║╚██████╔╝',  
                   '╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝'];
                                     

const TITLE_ART_WIDTH = TITLE_ART.reduce((maxWidth, line) => Math.max(maxWidth, displayWidth(line)), 0);

// 这些函数只负责把状态投影为可见行；resize 时可以用新宽度重新调用。
/**
 * 渲染顶部 banner，展示启动时真正对用户有用的最小上下文。
 *
 * 当前 banner 有三档：
 * 1. 宽终端：使用大字 ASCII Art 标题，强调启动瞬间的识别度；应用版本并入运行时信息行。
 * 2. 中等终端：回退到带边框的紧凑 banner，版本挂在标题上，保留 cwd 和 Node 版本独立行。
 * 3. 极窄终端：只保留最小可读标题和 cwd，优先避免横向撑爆。
 *
 */
export function renderBanner(context: BannerRenderContext = {}, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  const cwd = shortenPath(context.cwd || process.cwd(), 56);
  const nodeVersion = context.nodeVersion || process.version;
  const appVersion = context.appVersion || '';
  const terminalSize = context.terminalSize || { columns: 80, rows: 24 };
  const width = safeRenderWidth(terminalSize.columns);
  const nodeRuntimeInfo = `node ${nodeVersion}`;
  // 宽终端空间充足，应用版本并入运行时信息行；盒子标题过窄，版本挂在标题上，避免窄宽度 clamp 掉 Node 版本。
  const runtimeInfo = appVersion ? `echo_tui ${appVersion} · ${nodeRuntimeInfo}` : nodeRuntimeInfo;
  const boxTitle = appVersion ? ` echo_tui ${appVersion}` : ' echo_tui';

  if (context.variant === 'btw') {
    return renderBtwBanner(width, context.parentActivity || 'MAIN idle', theme);
  }

  // 宽度足够时优先显示大字标题，让启动 banner 具备类似 Spring Boot 的 splash 感。
  if (width >= TITLE_ART_WIDTH + 4) {
    const accentWidth = Math.min(width, TITLE_ART_WIDTH + 8);

    return [
      '',
        ...TITLE_ART.map((line) => ansi.bold(blockText(theme, 'bannerAccent', centerToDisplayWidth(padToDisplayWidth(line, TITLE_ART_WIDTH), width)))),
        blockText(theme, 'bannerMuted', centerToDisplayWidth('─'.repeat(accentWidth), width)),
        ansi.dim(blockText(theme, 'bannerMuted', centerToDisplayWidth(clampToDisplayWidth(`cwd  ${cwd}`, width), width))),
        ansi.dim(blockText(theme, 'bannerMuted', centerToDisplayWidth(clampToDisplayWidth(runtimeInfo, width), width))),
      ''
    ].join('\n');
  }

  // 宽度极小时退回最小版本，避免边框和多行元信息把内容横向挤爆。
  if (width < 12) {
    return [
      '',
      ansi.inverse(ansi.bold(padToDisplayWidth(clampToDisplayWidth(' echo_tui ', width), width))),
        blockText(theme, 'bannerMuted', padToDisplayWidth(clampToDisplayWidth(` cwd  ${cwd}`, width), width)),
      ''
    ].join('\n');
  }

  // 中等宽度使用盒子 banner，既保留强调感，也给 cwd / runtime 信息留出稳定容器。
  const innerWidth = width - 2;
  const border = ansi.bold(blockText(theme, 'bannerAccent', `╭${'─'.repeat(innerWidth)}╮`));
  const footerBorder = ansi.bold(blockText(theme, 'bannerAccent', `╰${'─'.repeat(innerWidth)}╯`));

  return [
    '',
    border,
      renderBannerBoxLine(boxTitle, innerWidth, (text) => ansi.inverse(ansi.bold(text)), theme),
      renderBannerBoxLine(` cwd  ${cwd}`, innerWidth, (text) => blockText(theme, 'bannerMuted', text), theme),
      renderBannerBoxLine(` ${nodeRuntimeInfo}`, innerWidth, (text) => ansi.dim(blockText(theme, 'bannerMuted', text)), theme),
    footerBorder,
    ''
  ].join('\n');
}

/**
 * 渲染 BTW 临时工作区的紧凑标题，避免模式切换时重复主界面大字 banner。
 */
function renderBtwBanner(width: number, parentActivity: string, theme: TuiTheme): string {
  if (width < 12) {
    return ['', ansi.bold(blockText(theme, 'bannerAccent', 'BTW')), ansi.dim(clampToDisplayWidth(parentActivity, width)), ''].join('\n');
  }

  const innerWidth = width - 2;
  const border = ansi.bold(blockText(theme, 'bannerAccent', `╭${'─'.repeat(innerWidth)}╮`));
  const footerBorder = ansi.bold(blockText(theme, 'bannerAccent', `╰${'─'.repeat(innerWidth)}╯`));
  return [
    '',
    border,
    renderBannerBoxLine(' BTW · 临时只读会话 · Esc 返回主会话', innerWidth, (text) => ansi.bold(text), theme),
    renderBannerBoxLine(` ${parentActivity}`, innerWidth, (text) => ansi.dim(text), theme),
    footerBorder,
    ''
  ].join('\n');
}

/**
 * 渲染 banner 的单行盒子内容，左右保留强调边框。
 *
 */
function renderBannerBoxLine(content: string, innerWidth: number, styleContent: TextStyle, theme: TuiTheme): string {
  const fitted = padToDisplayWidth(clampToDisplayWidth(content, innerWidth), innerWidth);
  return `${ansi.bold(blockText(theme, 'bannerAccent', '│'))}${styleContent(fitted)}${ansi.bold(blockText(theme, 'bannerAccent', '│'))}`;
}

/**
 * 把文本居中到目标显示宽度，给启动 banner 的标题和元信息建立更稳定的视觉中心。
 *
 */
function centerToDisplayWidth(text: string, width: number): string {
  const normalizedWidth = Math.max(0, width);
  const textWidth = displayWidth(text);

  if (textWidth >= normalizedWidth) {
    return text;
  }

  const remaining = normalizedWidth - textWidth;
  const leftPadding = Math.floor(remaining / 2);
  const rightPadding = remaining - leftPadding;
  return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
}

/**
 * 在超长 cwd 场景下截断路径，优先保留尾部信息。
 *
 */
function shortenPath(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) {
    return value;
  }

  return `...${value.slice(-(maxWidth - 3))}`;
}
