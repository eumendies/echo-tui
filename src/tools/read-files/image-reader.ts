import * as fs from 'node:fs';

import {isSupportedToolResultImageMediaType} from '../../types/tool';

import type {Sharp} from 'sharp';
import type {SupportedToolResultImageMediaType, ToolResultAttachment} from '../../types/tool';

type ImageReadOptions = {
  autoCompressImages: boolean; // 指示超出最终附件上限时是否尝试缩小图片。
  maxImageBytes: number; // 限制最终可发送附件的原始二进制字节数。
  maxInputPixels: number; // 限制解码后的所有帧总像素数，防止图片炸弹。
  maxSourceImageBytes: number; // 限制进入图片解码器的源文件字节数。
};

type ImageReadSuccess = {
  attachment: ToolResultAttachment; // 保存最终发送给模型的完整图片附件。
  compressed: boolean; // 标记附件字节是否由源图片重新编码产生。
  ok: true; // 区分成功结果，供调用方安全收窄联合类型。
  originalSizeBytes: number; // 保存磁盘源文件大小，供工具摘要展示压缩收益。
};

type ImageReadFailure = {
  ok: false; // 区分失败结果，失败时不得携带部分附件。
  reason: string; // 提供可回传模型的简洁失败原因。
  unsupported: boolean; // 区分不支持媒体类型与普通读取或压缩失败。
};

type ImageReadResult = ImageReadSuccess | ImageReadFailure;

const IMAGE_COMPRESSION_TARGET_RATIO = 0.9;
const MAX_IMAGE_COMPRESSION_ATTEMPTS = 8;
const MAX_INITIAL_IMAGE_EDGE = 4096;
const IMAGE_RESIZE_STEP = 0.8;
let sharpFactoryPromise: Promise<typeof import('sharp')> | null = null;

/**
 * 校验图片媒体类型和安全边界，必要时缩小并重新编码为可发送附件。
 */
async function readImageFile(pathText: string, absolutePath: string, mediaType: string, sizeBytes: number, options: ImageReadOptions): Promise<ImageReadResult> {
  if (!isSupportedToolResultImageMediaType(mediaType)) {
    return {
      ok: false,
      reason: `unsupported image media type: ${mediaType}`,
      unsupported: true
    };
  }

  if (sizeBytes > options.maxSourceImageBytes) {
    return {
      ok: false,
      reason: `image exceeds max source size: ${sizeBytes} bytes > ${options.maxSourceImageBytes} bytes`,
      unsupported: false
    };
  }

  if (sizeBytes <= options.maxImageBytes) {
    const source = await fs.promises.readFile(absolutePath);
    return createSuccess(pathText, mediaType, source, sizeBytes, false);
  }

  if (!options.autoCompressImages) {
    return {
      ok: false,
      reason: `image exceeds max size: ${sizeBytes} bytes > ${options.maxImageBytes} bytes`,
      unsupported: false
    };
  }

  try {
    const output = await compressImage(absolutePath, mediaType, sizeBytes, options);

    if (!output) {
      return {
        ok: false,
        reason: `image compression could not reduce output below ${options.maxImageBytes} bytes`,
        unsupported: false
      };
    }

    return createSuccess(pathText, mediaType, output, sizeBytes, true);
  } catch (error: unknown) {
    const reason = error instanceof Error && error.message.trim() !== ''
      ? error.message
      : 'image compression failed';
    return {
      ok: false,
      reason: `image compression failed: ${reason}`,
      unsupported: false
    };
  }
}

function createSuccess(pathText: string, mediaType: SupportedToolResultImageMediaType, data: Buffer, originalSizeBytes: number, compressed: boolean): ImageReadSuccess {
  return {
    attachment: {
      kind: 'image',
      mediaType,
      dataBase64: data.toString('base64'),
      path: pathText,
      sizeBytes: data.length
    },
    compressed,
    ok: true,
    originalSizeBytes
  };
}

/**
 * 延迟加载平台图片运行时，使安装异常只影响真正需要压缩的超限图片。
 */
function loadSharp(): Promise<typeof import('sharp')> {
  sharpFactoryPromise ??= Promise.resolve().then(() => require('sharp') as typeof import('sharp'));
  return sharpFactoryPromise;
}

/**
 * 在有限次等比缩放中重新编码原格式，并只返回满足最终字节上限的完整输出。
 */
async function compressImage(absolutePath: string, mediaType: SupportedToolResultImageMediaType, sourceSizeBytes: number, options: ImageReadOptions): Promise<Buffer | null> {
  const sharp = await loadSharp();
  const animated = mediaType === 'image/gif';
  const inputOptions = {
    animated,
    failOn: 'error' as const,
    limitInputPixels: options.maxInputPixels
  };
  const metadata = await sharp(absolutePath, inputOptions).metadata();
  const width = metadata.autoOrient.width;
  const frameHeight = metadata.pageHeight ?? metadata.autoOrient.height;
  const pages = metadata.pages ?? 1;
  const totalPixels = width * frameHeight * pages;

  if (!Number.isSafeInteger(totalPixels) || totalPixels <= 0 || totalPixels > options.maxInputPixels) {
    throw new Error(`image exceeds max decoded pixels: ${totalPixels} > ${options.maxInputPixels}`);
  }

  const targetBytes = Math.max(1, Math.floor(options.maxImageBytes * IMAGE_COMPRESSION_TARGET_RATIO));
  const byteScale = Math.sqrt(targetBytes / sourceSizeBytes);
  const edgeScale = Math.min(1, MAX_INITIAL_IMAGE_EDGE / Math.max(width, frameHeight));
  const initialScale = Math.min(1, byteScale, edgeScale);
  let targetWidth = Math.max(1, Math.floor(width * initialScale));
  let targetHeight = Math.max(1, Math.floor(frameHeight * initialScale));

  for (let attempt = 0; attempt < MAX_IMAGE_COMPRESSION_ATTEMPTS; attempt += 1) {
    let pipeline = sharp(absolutePath, inputOptions);

    if (!animated) {
      pipeline = pipeline.autoOrient();
    }

    pipeline = pipeline.resize({
      width: targetWidth,
      height: targetHeight,
      fit: 'inside',
      withoutEnlargement: true
    });
    const output = await encodeImage(pipeline, mediaType).toBuffer();

    if (output.length <= options.maxImageBytes) {
      return output;
    }

    const nextWidth = Math.max(1, Math.floor(targetWidth * IMAGE_RESIZE_STEP));
    const nextHeight = Math.max(1, Math.floor(targetHeight * IMAGE_RESIZE_STEP));

    if (nextWidth === targetWidth && nextHeight === targetHeight) {
      break;
    }

    targetWidth = nextWidth;
    targetHeight = nextHeight;
  }

  return null;
}

function encodeImage(pipeline: Sharp, mediaType: SupportedToolResultImageMediaType): Sharp {
  switch (mediaType) {
    case 'image/jpeg':
      return pipeline.jpeg({quality: 82, mozjpeg: true});
    case 'image/png':
      return pipeline.png({adaptiveFiltering: true, compressionLevel: 9});
    case 'image/webp':
      return pipeline.webp({effort: 5, quality: 82});
    case 'image/gif':
      return pipeline.gif({colours: 256, dither: 0.8, effort: 7});
  }
}

export {
  readImageFile
};

export type {
  ImageReadOptions,
  ImageReadResult
};
