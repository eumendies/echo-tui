import type {SearchResult} from './shared';

export function parseBingHtmlResults(html: string, count: number): {ok: true; results: SearchResult[]; truncated: boolean} | {ok: false; reason: string} {
  // Bing HTML 不是稳定 API，只抽取自然结果 li.b_algo；卡片、广告和富结果都故意跳过。
  const blocks = extractBingResultBlocks(html);

  if (blocks.length === 0) {
    if (isNoResultsPage(html)) {
      return {ok: true, results: [], truncated: false};
    }

    return {ok: false, reason: 'public search page did not contain parseable natural results'};
  }

  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();
  let truncated = false;

  for (const block of blocks) {
    const result = parseBingResultBlock(block);

    if (!result || seenUrls.has(result.url)) {
      continue;
    }

    seenUrls.add(result.url);

    if (results.length < count) {
      results.push(result);
    } else {
      truncated = true;
    }
  }

  return {
    ok: true,
    results,
    truncated
  };
}

export function parseDuckDuckGoHtmlResults(html: string, count: number): {ok: true; results: SearchResult[]; truncated: boolean} | {ok: false; reason: string} {
  // DuckDuckGo HTML fallback 的自然结果锚点相对稳定，摘要从相邻结果块里补取。
  const anchors = [...html.matchAll(/<a\b(?=[^>]*class=(['"])[^'"]*\bresult__a\b[^'"]*\1)[^>]*href=(['"])(.*?)\2[^>]*>([\s\S]*?)<\/a>/gi)];

  if (anchors.length === 0) {
    if (isNoResultsPage(html)) {
      return {ok: true, results: [], truncated: false};
    }

    return {ok: false, reason: 'public search fallback page did not contain parseable natural results'};
  }

  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();
  let truncated = false;

  for (const [index, anchor] of anchors.entries()) {
    const url = normalizeResultUrl(anchor[3]);
    const title = htmlToPlainText(anchor[4]);

    if (!url || !title || seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);

    if (results.length < count) {
      results.push({
        snippet: extractDuckDuckGoSnippet(html.slice(anchor.index || 0, anchors[index + 1]?.index || html.length)),
        title,
        url
      });
    } else {
      truncated = true;
    }
  }

  return {ok: true, results, truncated};
}

function extractDuckDuckGoSnippet(block: string): string {
  const snippet = /<(?:a|div)\b[^>]*class=(['"])[^'"]*\bresult__snippet\b[^'"]*\1[^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(block);
  return snippet ? htmlToPlainText(snippet[2]) : '';
}

function extractBingResultBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern = /<li\b[^>]*class=(['"])[^'"]*\bb_algo\b[^'"]*\1[^>]*>[\s\S]*?<\/li>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    blocks.push(match[0]);
  }

  return blocks;
}

function parseBingResultBlock(block: string): SearchResult | null {
  const h2 = /<h2\b[^>]*>[\s\S]*?<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i.exec(block);

  if (!h2) {
    return null;
  }

  const url = normalizeResultUrl(h2[2]);

  if (!url) {
    return null;
  }

  const title = htmlToPlainText(h2[3]);

  if (!title) {
    return null;
  }

  return {
    snippet: extractSnippet(block),
    title,
    url
  };
}

function extractSnippet(block: string): string {
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block);
  return paragraph ? htmlToPlainText(paragraph[1]) : '';
}

function normalizeResultUrl(rawUrl: string): string | null {
  const decoded = decodeHtmlEntities(rawUrl.trim());

  if (!decoded || decoded.toLowerCase().startsWith('javascript:')) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded);
  } catch {
    return null;
  }

  if (isBingHost(url.hostname)) {
    // Bing 自然结果经常包一层 /ck/a?u=... 跳转，必须解出真实 URL 才能去重和做 host 匹配。
    const unwrapped = unwrapBingRedirectUrl(url);

    if (!unwrapped) {
      return null;
    }

    url = unwrapped;
  }

  if (isDuckDuckGoHost(url.hostname)) {
    // DuckDuckGo HTML 使用 uddg 参数承载目标 URL；保留跳转页会污染结果来源。
    const unwrapped = unwrapDuckDuckGoRedirectUrl(url);

    if (!unwrapped) {
      return null;
    }

    url = unwrapped;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  if (isBingHost(url.hostname) || isDuckDuckGoHost(url.hostname)) {
    // 解包失败的搜索引擎内部链接不算自然结果，避免把搜索页自身返回给模型。
    return null;
  }

  url.hash = '';
  return url.toString();
}

function unwrapDuckDuckGoRedirectUrl(url: URL): URL | null {
  const encoded = url.searchParams.get('uddg');

  if (!encoded) {
    return null;
  }

  try {
    return new URL(encoded);
  } catch {
    return null;
  }
}

function unwrapBingRedirectUrl(url: URL): URL | null {
  const encoded = url.searchParams.get('u');

  if (!encoded) {
    return null;
  }

  const decoded = decodeBingUrlParameter(encoded);

  if (!decoded) {
    return null;
  }

  try {
    return new URL(decoded);
  } catch {
    return null;
  }
}

function decodeBingUrlParameter(value: string): string | null {
  const candidate = value.startsWith('a1') ? value.slice(2) : value;
  const padded = candidate.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(candidate.length / 4) * 4, '=');

  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return decoded.startsWith('http://') || decoded.startsWith('https://') ? decoded : null;
  } catch {
    return null;
  }
}

function isBingHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  return host === 'bing.com' || host.endsWith('.bing.com');
}

function isDuckDuckGoHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  return host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com');
}

export function isBlockedSearchPage(html: string): boolean {
  // 公共 HTML 搜索偶尔返回验证码/风控页；这种页面即使 HTTP 200 也不能进入解析链路。
  const text = html.toLowerCase();
  return text.includes('captcha')
    || text.includes('verify you are human')
    || text.includes('unusual traffic')
    || text.includes('b_captcha')
    || text.includes('bots use duckduckgo too')
    || text.includes('select all squares containing a duck')
    || text.includes('error-lite@duckduckgo.com');
}

function isNoResultsPage(html: string): boolean {
  return /class=(['"])[^'"]*\bb_no\b[^'"]*\1/i.test(html) || /no results found|there are no results/i.test(html);
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<\s*(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t\r\n\f\v]+/g, ' ')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();

    if (lower === 'amp') {
      return '&';
    }
    if (lower === 'lt') {
      return '<';
    }
    if (lower === 'gt') {
      return '>';
    }
    if (lower === 'quot') {
      return '"';
    }
    if (lower === 'apos') {
      return "'";
    }
    if (lower === 'nbsp') {
      return ' ';
    }

    const codePoint = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);

    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
      return match;
    }

    return String.fromCodePoint(codePoint);
  });
}
