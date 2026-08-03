import {type TuiTheme} from '../../config/theme-config';
import {createEditFileCallLabel, EDIT_FILE_TOOL_NAME} from '../../tools/edit-file-tool-handler';
import {createToolCallTitle, renderPrefixedLines, resolveToolCallPrefixStyle} from './shared';

import type {ToolCallTranscriptRecord} from '../../types/transcript';

/**
 * edit_file 调用只展示目标路径和 replace-all 标记，不泄漏完整替换文本。
 */
function renderEditFileToolCallLines(
  record: ToolCallTranscriptRecord,
  width: number,
  callStatus: boolean | undefined,
  theme: TuiTheme
): string[] {
  const label = createEditFileCallLabel(record.argumentsText);
  const prefix = `${EDIT_FILE_TOOL_NAME}(`;
  const summary = label.startsWith(prefix) && label.endsWith(')') ? label.slice(prefix.length, -1) : null;
  const replaceAllSuffix = ', replace all';
  const segments = summary?.endsWith(replaceAllSuffix)
    ? [summary.slice(0, -replaceAllSuffix.length), 'replace all']
    : [summary];
  return renderPrefixedLines({
    text: createToolCallTitle(EDIT_FILE_TOOL_NAME, segments),
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
    colorizeFirstSymbol: resolveToolCallPrefixStyle(callStatus, theme)
  });
}

export {
  EDIT_FILE_TOOL_NAME,
  renderEditFileToolCallLines
};
