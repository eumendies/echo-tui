import {getValidImageAttachments} from '../transcript-converter-common';

import type {ToolResultImageAttachment} from '../../types/tool';
import type {TranscriptRecord} from '../../types/transcript';

const DEFAULT_CONVERSATION_IMAGE_BYTES = 10_000_000;
// 仅供提前触发上下文压缩；实际上传规模由二进制字节预算独立约束。
const ESTIMATED_IMAGE_TOKENS = 2_048;

type ImageBudgetResult = {
  records: TranscriptRecord[]; // 本次 provider 请求的投影；未超限时复用原数组。
  omittedImages: number; // 本次请求因预算未附带的图片数量。
};

function imageBytes(attachment: Pick<ToolResultImageAttachment, 'dataBase64'>): number {
  // 历史 journal 的 sizeBytes 可能缺失或不准确，必须按实际将发送的 base64 数据计量。
  return Buffer.byteLength(attachment.dataBase64, 'base64');
}

function getConversationImageBytes(records: TranscriptRecord[]): number {
  return records.reduce((total, record) => {
    if (record.role !== 'user' && record.role !== 'tool_result') {
      return total;
    }

    return total + getValidImageAttachments(record).reduce((sum, attachment) => sum + imageBytes(attachment), 0);
  }, 0);
}

function estimateRecordImageTokens(record: TranscriptRecord): number {
  return record.role === 'user' || record.role === 'tool_result'
    ? getValidImageAttachments(record).length * ESTIMATED_IMAGE_TOKENS
    : 0;
}

/**
 * 只在总图片字节超限时生成请求副本；从后向前选图以优先保留最新像素，
 * 最终仍按历史原顺序投影，且不修改 transcript、tool 配对或 provider reasoning。
 */
function boundConversationImages(records: TranscriptRecord[], maxBytes = DEFAULT_CONVERSATION_IMAGE_BYTES): ImageBudgetResult {
  if (getConversationImageBytes(records) <= maxBytes) {
    return {records, omittedImages: 0};
  }

  const kept = new Map<number, Set<number>>();
  let remaining = maxBytes;

  for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
    const record = records[recordIndex];
    if (record.role !== 'user' && record.role !== 'tool_result') {
      continue;
    }

    const valid = new Set(getValidImageAttachments(record));
    for (let imageIndex = (record.attachments?.length ?? 0) - 1; imageIndex >= 0; imageIndex -= 1) {
      const attachment = record.attachments?.[imageIndex];
      if (!attachment || !valid.has(attachment)) {
        continue;
      }

      const bytes = imageBytes(attachment);
      if (bytes <= remaining) {
        const indices = kept.get(recordIndex) ?? new Set<number>();
        indices.add(imageIndex);
        kept.set(recordIndex, indices);
        remaining -= bytes;
      }
    }
  }

  let omittedImages = 0;
  const projected = records.map((record, recordIndex): TranscriptRecord => {
    if (record.role !== 'user' && record.role !== 'tool_result') {
      return record;
    }

    const valid = new Set(getValidImageAttachments(record));
    const omissions: string[] = [];
    const attachments = record.attachments?.filter((attachment, imageIndex) => {
      if (!valid.has(attachment) || kept.get(recordIndex)?.has(imageIndex)) {
        return true;
      }

      omittedImages += 1;
      if (record.role === 'tool_result' && record.toolName === 'read_files' && attachment.path) {
        omissions.push(`Image ${JSON.stringify(attachment.path)} omitted from this request due to the conversation image budget; use read_files to view it again if needed.`);
      } else {
        omissions.push('Image omitted from this request due to the conversation image budget; its pixels are not visible here.');
      }
      return false;
    });

    return omissions.length === 0 ? record : {
      ...record,
      attachments,
      text: `${record.text}\n${omissions.join('\n')}`
    };
  });

  return {records: projected, omittedImages};
}

export {
  DEFAULT_CONVERSATION_IMAGE_BYTES,
  boundConversationImages,
  estimateRecordImageTokens,
  getConversationImageBytes
};
