import type {CustomSubagentCapability} from './definition';

const MAX_CUSTOM_SUBAGENT_FILE_BYTES = 40 * 1024;
const MAX_CUSTOM_SUBAGENT_BODY_BYTES = 32 * 1024;
const MAX_CUSTOM_SUBAGENT_DESCRIPTION_CODE_POINTS = 500;

type CustomSubagentManifest = {
  capability: CustomSubagentCapability; // 选择系统拥有的只读或通用权限模板。
  description: string; // 主 Agent 目录可见的简短能力说明。
  instructions: string; // 追加在系统基础约束后的非空 Markdown 角色正文。
  mcp: boolean; // 通用能力是否请求父运行已初始化的 MCP 工具；只读能力后续强制拒绝。
  tools: readonly string[]; // manifest 声明的 provider-neutral 本地能力名称。
};

type CustomSubagentManifestParseError = {
  code: string; // 稳定机器错误码，不包含文件正文。
  message: string; // 不包含文件正文的可操作错误摘要。
};

type CustomSubagentManifestParseResult =
  | {ok: true; manifest: Readonly<CustomSubagentManifest>} // 成功时返回校验后的 manifest。
  | {ok: false; error: Readonly<CustomSubagentManifestParseError>}; // 失败时不返回部分定义。

type ParsedFrontmatter = {
  capability?: string; // 尚未完成枚举校验的 capability 标量。
  description?: string; // 尚未完成长度校验的 description 标量。
  mcp?: string; // 尚未完成布尔校验的可选 mcp 标量。
  tools?: string[]; // 按声明顺序收集的工具序列。
};

/**
 * 解析自定义 Subagent 的受限 Markdown manifest。
 * 仅接受固定 frontmatter 标量和 tools 字符串序列，不执行 YAML、模板或变量替换。
 */
function parseCustomSubagentManifest(rawContent: string): CustomSubagentManifestParseResult {
  if (typeof rawContent !== 'string') {
    return parseFailure('invalid_file', 'Agent manifest must be UTF-8 text.');
  }
  if (Buffer.byteLength(rawContent, 'utf8') > MAX_CUSTOM_SUBAGENT_FILE_BYTES) {
    return parseFailure('file_too_large', `Agent manifest exceeds ${MAX_CUSTOM_SUBAGENT_FILE_BYTES} UTF-8 bytes.`);
  }
  if (/[^\t\n\r\x20-\x7e\u0080-\u{10ffff}]/u.test(rawContent)) {
    return parseFailure('control_character', 'Agent manifest contains unsupported control characters.');
  }

  const normalized = rawContent.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    return parseFailure('missing_frontmatter', 'Agent manifest must start with a standalone --- line.');
  }

  const closingIndex = lines.indexOf('---', 1);
  if (closingIndex < 0) {
    return parseFailure('unterminated_frontmatter', 'Agent manifest frontmatter must end with a standalone --- line.');
  }
  if (lines.slice(1, closingIndex).some((line) => line === '...')) {
    return parseFailure('unsupported_structure', 'Multiple-document YAML syntax is not supported.');
  }

  const frontmatterResult = parseFrontmatterLines(lines.slice(1, closingIndex));
  if (!frontmatterResult.ok) {
    return frontmatterResult;
  }

  const body = lines.slice(closingIndex + 1).join('\n').trim();
  if (body === '') {
    return parseFailure('missing_body', 'Agent manifest must contain non-empty Markdown instructions.');
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_CUSTOM_SUBAGENT_BODY_BYTES) {
    return parseFailure('body_too_large', `Agent instructions exceed ${MAX_CUSTOM_SUBAGENT_BODY_BYTES} UTF-8 bytes.`);
  }

  return validateParsedFrontmatter(frontmatterResult.fields, body);
}

/** 按严格行语法解析 frontmatter，遇到任一未知、重复或嵌套结构即拒绝整个文件。 */
function parseFrontmatterLines(lines: readonly string[]): {ok: true; fields: ParsedFrontmatter} | {ok: false; error: Readonly<CustomSubagentManifestParseError>} {
  const fields: ParsedFrontmatter = {};
  const seen = new Set<string>();
  let collectingTools = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') {
      continue;
    }

    if (collectingTools && /^  - /u.test(line)) {
      const toolResult = parseScalar(line.slice(4), 'tools item');
      if (!toolResult.ok) {
        return toolResult;
      }
      fields.tools!.push(toolResult.value);
      continue;
    }
    collectingTools = false;

    if (/^[ \t]/u.test(line)) {
      return parseFailure('unsupported_structure', `Unsupported indentation on frontmatter line ${index + 2}.`);
    }

    const match = /^([a-z]+):(.*)$/u.exec(line);
    if (!match) {
      return parseFailure('invalid_frontmatter', `Invalid frontmatter syntax on line ${index + 2}.`);
    }

    const key = match[1];
    const rawValue = match[2];
    if (!['description', 'capability', 'tools', 'mcp'].includes(key)) {
      return parseFailure('unknown_field', 'Unknown frontmatter field.');
    }
    if (seen.has(key)) {
      return parseFailure('duplicate_field', `Duplicate frontmatter field: ${key}.`);
    }
    seen.add(key);

    if (key === 'tools') {
      if (rawValue.trim() !== '') {
        return parseFailure('unsupported_structure', 'tools must use an indented string sequence, not an inline value.');
      }
      fields.tools = [];
      collectingTools = true;
      continue;
    }

    if (!rawValue.startsWith(' ')) {
      return parseFailure('invalid_frontmatter', `Field ${key} requires one space after the colon.`);
    }
    if (key === 'mcp' && /^["']/u.test(rawValue.trim())) {
      return parseFailure('invalid_mcp', 'mcp must be the unquoted boolean true or false.');
    }
    const scalarResult = parseScalar(rawValue.slice(1), key);
    if (!scalarResult.ok) {
      return scalarResult;
    }
    fields[key as 'description' | 'capability' | 'mcp'] = scalarResult.value;
  }

  return {ok: true, fields};
}

/** 解析普通或成对引号标量；刻意不实现 YAML 转义、tag、anchor 和复合值。 */
function parseScalar(rawValue: string, field: string): {ok: true; value: string} | {ok: false; error: Readonly<CustomSubagentManifestParseError>} {
  const value = rawValue.trim();
  if (value === '') {
    return parseFailure('empty_field', `Field ${field} must not be empty.`);
  }
  if (/^(?:[&*!|>{[]|---$|\.\.\.$)/u.test(value) || value.includes('{{') || value.includes('${')) {
    return parseFailure('unsupported_structure', `Field ${field} uses unsupported YAML or template syntax.`);
  }

  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if (first === '"' || first === "'") {
    if (last !== first || value.length < 2) {
      return parseFailure('invalid_scalar', `Field ${field} has unmatched quotes.`);
    }
    const unquoted = value.slice(1, -1);
    if (unquoted.includes(first)) {
      return parseFailure('unsupported_structure', `Field ${field} uses unsupported quote escaping.`);
    }
    if (unquoted === '') {
      return parseFailure('empty_field', `Field ${field} must not be empty.`);
    }
    return {ok: true, value: unquoted};
  }
  if (last === '"' || last === "'" || /[\[\]{}]/u.test(value)) {
    return parseFailure('unsupported_structure', `Field ${field} uses unsupported scalar syntax.`);
  }
  return {ok: true, value};
}

/** 校验必填字段和固定输入预算，并产出不可变领域对象。 */
function validateParsedFrontmatter(fields: ParsedFrontmatter, body: string): CustomSubagentManifestParseResult {
  for (const key of ['description', 'capability', 'tools'] as const) {
    if (fields[key] === undefined) {
      return parseFailure('missing_field', `Missing required frontmatter field: ${key}.`);
    }
  }

  if (Array.from(fields.description!).length > MAX_CUSTOM_SUBAGENT_DESCRIPTION_CODE_POINTS) {
    return parseFailure('description_too_long', `description exceeds ${MAX_CUSTOM_SUBAGENT_DESCRIPTION_CODE_POINTS} Unicode code points.`);
  }
  if (fields.capability !== 'readonly' && fields.capability !== 'general') {
    return parseFailure('invalid_capability', 'capability must be readonly or general.');
  }
  if (fields.mcp !== undefined && fields.mcp !== 'true' && fields.mcp !== 'false') {
    return parseFailure('invalid_mcp', 'mcp must be the unquoted boolean true or false.');
  }
  const seenTools = new Set<string>();
  for (const tool of fields.tools!) {
    if (!/^[a-z][a-z0-9_]*$/u.test(tool)) {
      return parseFailure('invalid_tool', `Invalid local tool name: ${safeDiagnosticValue(tool)}.`);
    }
    if (seenTools.has(tool)) {
      return parseFailure('duplicate_tool', `Duplicate local tool name: ${tool}.`);
    }
    seenTools.add(tool);
  }

  const manifest: CustomSubagentManifest = {
    capability: fields.capability,
    description: fields.description!,
    instructions: body,
    mcp: fields.mcp === 'true',
    tools: fields.tools!
  };
  return {ok: true, manifest};
}

/** 创建不携带文件正文的结构化解析错误。 */
function parseFailure(code: string, message: string): {ok: false; error: Readonly<CustomSubagentManifestParseError>} {
  return {ok: false, error: {code, message}};
}

/** 限制不可信字段值进入错误消息的长度和字符范围。 */
function safeDiagnosticValue(value: string): string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')).slice(0, 80).join('');
}

export {
  MAX_CUSTOM_SUBAGENT_BODY_BYTES,
  MAX_CUSTOM_SUBAGENT_DESCRIPTION_CODE_POINTS,
  MAX_CUSTOM_SUBAGENT_FILE_BYTES,
  parseCustomSubagentManifest
};

export type {CustomSubagentManifest, CustomSubagentManifestParseError, CustomSubagentManifestParseResult};
