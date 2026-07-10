import {parseFileMentions} from '../input/file-mentions';
import {
  DEFAULT_MAX_DIRECTORY_ENTRIES,
  DEFAULT_MAX_FILE_CONTENT_BYTES,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_PDF_BYTES,
  DEFAULT_MAX_TOTAL_OUTPUT_BYTES
} from '../tools/read-files';
import {readOneFile} from '../tools/read-files/readers';

import type {ToolResultAttachment} from '../types/tool';
import type {FileReadResult} from '../tools/read-files/readers';

type ExpandedFileContext = {
  attachments?: ToolResultAttachment[];
  text: string;
};

/**
 * 在固定长度选项中循环移动选择位置；空列表统一落回 0。
 */
function moveWrappedIndex(index: number, direction: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return (index + direction + length) % length;
}

/**
 * 展开用户输入中的路径 mention，生成模型可见的文件、目录上下文和图片附件。
 */
async function expandFileMentionsForUserText(userText: string, cwd: string): Promise<ExpandedFileContext> {
  const mentions = parseFileMentions(userText);

  if (mentions.length === 0) {
    return {text: userText};
  }

  const uniquePaths = Array.from(new Set(mentions.map((mention) => mention.path)));
  const sections: string[] = [];
  const attachments: ToolResultAttachment[] = [];

  for (const filePath of uniquePaths) {
    const result = await readOneFile({path: filePath, offset: 0}, {
      cwd,
      limits: {
        maxDirectoryEntries: DEFAULT_MAX_DIRECTORY_ENTRIES,
        maxFileContentBytes: DEFAULT_MAX_FILE_CONTENT_BYTES,
        maxFiles: uniquePaths.length,
        maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
        maxPdfBytes: DEFAULT_MAX_PDF_BYTES,
        maxTotalOutputBytes: DEFAULT_MAX_TOTAL_OUTPUT_BYTES
      }
    });
    sections.push(formatSelectedFileForModel(filePath, result));

    if (result.attachments) {
      attachments.push(...result.attachments);
    }
  }

  return {
    ...(attachments.length > 0 ? {attachments} : {}),
    text: [
      userText,
      '',
      '<selected_files>',
      ...sections,
      '</selected_files>'
    ].join('\n')
  };
}

/**
 * 将 read_files 的工具输出压缩成路径上下文，只保留模型实际需要的内容或直接子项。
 */
function formatSelectedFileForModel(filePath: string, result: FileReadResult): string {
  const content = extractLabeledFence(result.text, 'content')
    ?? extractLabeledFence(result.text, 'content_with_line_numbers')
    ?? extractLabeledFence(result.text, 'extracted_text');

  if (content !== null) {
    return [
      `--- selected_file: ${filePath}`,
      '```',
      content,
      '```'
    ].join('\n');
  }

  if (result.attachments && result.attachments.length > 0) {
    return [
      `--- selected_file: ${filePath}`,
      '[image attached]'
    ].join('\n');
  }

  const directoryEntries = extractDirectoryEntries(result.text);

  if (directoryEntries !== null) {
    return [
      `--- selected_directory: ${filePath}`,
      'direct_entries:',
      directoryEntries,
      ...(extractBooleanMetadata(result.text, 'has_more') ? ['[additional direct entries omitted]'] : [])
    ].join('\n');
  }

  return [
    `--- selected_file: ${filePath}`,
    `[unavailable: ${extractReadError(result.text)}]`
  ].join('\n');
}

function extractLabeledFence(text: string, label: string): string | null {
  const marker = `${label}:\n\`\`\`\n`;
  const start = text.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const contentStart = start + marker.length;
  const contentEnd = text.indexOf('\n```', contentStart);

  return contentEnd === -1 ? text.slice(contentStart) : text.slice(contentStart, contentEnd);
}

function extractDirectoryEntries(text: string): string | null {
  if (!/^--- directory: /mu.test(text) && !/^kind: directory$/mu.test(text)) {
    return null;
  }

  const marker = 'entries:\n';
  const start = text.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const entriesStart = start + marker.length;
  const oldEntriesEnd = text.indexOf('\n\nrecursive:', entriesStart);
  const newEntriesEnd = text.indexOf('\n\nhas_more:', entriesStart);
  const entriesEndCandidates = [oldEntriesEnd, newEntriesEnd].filter((index) => index >= 0);
  const entriesEnd = entriesEndCandidates.length === 0 ? -1 : Math.min(...entriesEndCandidates);

  return entriesEnd === -1 ? text.slice(entriesStart).trimEnd() : text.slice(entriesStart, entriesEnd);
}

function extractBooleanMetadata(text: string, field: string): boolean {
  return new RegExp(`^${field}: true$`, 'mu').test(text);
}

function extractReadError(text: string): string {
  const error = text.match(/^error: (.+)$/mu)?.[1] || text.match(/^reason: (.+)$/mu)?.[1];
  return error || 'failed to read file';
}

export {expandFileMentionsForUserText, moveWrappedIndex};
export type {ExpandedFileContext};
