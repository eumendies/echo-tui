import {type TuiTheme} from '../../config/theme-config';
import {createEditFileCallLabel, EDIT_FILE_TOOL_NAME} from '../../tools/edit-file-tool-handler';
import {renderPrefixedLines, resolveToolCallPrefixStyle} from './shared';

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
  return renderPrefixedLines({
    text: createEditFileCallLabel(record.argumentsText),
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
