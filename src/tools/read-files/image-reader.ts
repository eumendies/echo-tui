import * as fs from 'node:fs';

import {isSupportedToolResultImageMediaType} from '../../types/tool';

import type {ToolResultAttachment} from '../../types/tool';

type ImageReadResult =
  | {ok: true; attachment: ToolResultAttachment}
  | {ok: false; reason: string; unsupported: boolean};

/**
 * 校验图片媒体类型和大小后读取附件数据，不负责构造公共文件 envelope。
 */
function readImageFile(pathText: string, absolutePath: string, mediaType: string, sizeBytes: number, maxImageBytes: number): ImageReadResult {
  if (!isSupportedToolResultImageMediaType(mediaType)) {
    return {
      ok: false,
      reason: `unsupported image media type: ${mediaType}`,
      unsupported: true
    };
  }

  if (sizeBytes > maxImageBytes) {
    return {
      ok: false,
      reason: `image exceeds max size: ${sizeBytes} bytes > ${maxImageBytes} bytes`,
      unsupported: false
    };
  }

  return {
    ok: true,
    attachment: {
      kind: 'image',
      mediaType,
      dataBase64: fs.readFileSync(absolutePath).toString('base64'),
      path: pathText,
      sizeBytes
    }
  };
}

export {
  readImageFile
};
