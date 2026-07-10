import * as fs from 'node:fs/promises';

import {capUtf8Text} from '../tool-handler-utils';

import type {Result} from '../tool-handler-utils';

type PdfTextExtractionResult = {
  content: string;
  contentTruncated: boolean;
  pageCount: number;
  pagesWithText: number;
};

type PdfJsTextItem = {
  str: string;
};

type PdfJsTextMarkedContent = {
  type: string;
};

type PdfJsTextContent = {
  items: Array<PdfJsTextItem | PdfJsTextMarkedContent>;
};

type PdfJsPage = {
  getTextContent(): Promise<PdfJsTextContent>;
};

type PdfJsDocument = {
  destroy(): Promise<void>;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  numPages: number;
};

type PdfJsLoadingTask = {
  promise: Promise<PdfJsDocument>;
};

type PdfJsModule = {
  getDocument(options: Record<string, unknown>): PdfJsLoadingTask;
};

/**
 * PDF.js 以 ESM 发布；动态导入把兼容性边界限定在 PDF reader 内。
 */
async function loadPdfJs(): Promise<PdfJsModule> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
  return await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs') as PdfJsModule;
}

async function extractPdfText(absolutePath: string, maxContentBytes: number): Promise<Result<PdfTextExtractionResult>> {
  let document: PdfJsDocument | undefined;

  try {
    const bytes = await fs.readFile(absolutePath);
    const pdfjs = await loadPdfJs();
    document = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0
    }).promise;

    const parts: string[] = [];
    let contentBytes = 0;
    let contentTruncated = false;
    let pagesWithText = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const pageTextItems = (await page.getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .filter((text) => text.trim() !== '');
      const pageText = pageTextItems
        .join(' ')
        .trim();

      if (pageText === '') {
        continue;
      }

      pagesWithText += 1;

      const separator = parts.length === 0 ? '' : '\n\n';
      const remainingBytes = maxContentBytes - contentBytes - Buffer.byteLength(separator, 'utf8');

      if (remainingBytes <= 0) {
        contentTruncated = true;
        break;
      }

      const capped = capUtf8Text(pageText, remainingBytes);
      parts.push(`${separator}${capped.text}`);
      contentBytes += Buffer.byteLength(separator, 'utf8') + Buffer.byteLength(capped.text, 'utf8');

      if (capped.truncated) {
        contentTruncated = true;
        break;
      }
    }

    const content = parts.join('').trim();

    if (content === '') {
      return {ok: false, reason: 'no extractable text; OCR and page rendering are not supported'};
    }

    return {
      ok: true,
      value: {
        content,
        contentTruncated,
        pageCount: document.numPages,
        pagesWithText
      }
    };
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.trim() !== '' ? error.message : 'PDF text extraction failed';
    return {ok: false, reason: `PDF text extraction failed: ${message}`};
  } finally {
    if (document) {
      await document.destroy();
    }
  }
}

export {
  extractPdfText
};

export type {
  PdfTextExtractionResult
};
