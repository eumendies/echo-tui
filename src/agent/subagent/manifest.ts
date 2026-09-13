import type {CustomSubagentCapability, SubagentEffortPolicy} from './definition';

const MAX_CUSTOM_SUBAGENT_FILE_BYTES = 40 * 1024;
const MAX_CUSTOM_SUBAGENT_BODY_BYTES = 32 * 1024;
const MAX_CUSTOM_SUBAGENT_DESCRIPTION_CODE_POINTS = 500;
const MAX_CUSTOM_SUBAGENT_SKILL_NAME_CODE_POINTS = 128;

type CustomSubagentManifest = {
  capability: CustomSubagentCapability; // 选择系统拥有的只读或通用权限模板。
  description: string; // 主 Agent 目录可见的简短能力说明。
  effort: SubagentEffortPolicy; // 子运行继承父覆盖、采用模型默认值或使用固定强度的策略。
  instructions: string; // 追加在系统基础约束后的非空 Markdown 角色正文。
  mcp: boolean; // 通用能力是否请求父运行已初始化的 MCP 工具；只读能力后续强制拒绝。
  modelProfileId?: string; // 同一用户配置 snapshot 内严格引用的非敏感模型 profile id。
  skillNames?: readonly string[]; // 三态 Skill allowlist：缺省允许全部 enabled Skills，空数组明确禁止，非空按名称收窄。
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
  effort?: string; // 尚未完成策略枚举校验的 effort 标量。
  mcp?: string; // 尚未完成布尔校验的可选 mcp 标量。
  model?: string; // 尚未完成非空校验的模型 profile 标量。
  skills?: string[]; // 按声明顺序收集的 Skill 名称序列；存在但无条目表示显式空 allowlist。
  tools?: string[]; // 按声明顺序收集的工具序列。
};

const SUBAGENT_EFFORT_POLICIES = Object.freeze([
  'inherit',
  'default',
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const);

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
  let collecting: 'tools' | 'skills' | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') {
      continue;
    }

    if (collecting && /^  - /u.test(line)) {
      const itemResult = parseScalar(line.slice(4), `${collecting} item`);
      if (!itemResult.ok) {
        return itemResult;
      }
      if (collecting === 'tools') {
        fields.tools!.push(itemResult.value);
      } else {
        fields.skills!.push(itemResult.value);
      }
      continue;
    }
    collecting = undefined;

    if (/^[ \t]/u.test(line)) {
      return parseFailure('unsupported_structure', `Unsupported indentation on frontmatter line ${index + 2}.`);
    }

    const match = /^([a-z]+):(.*)$/u.exec(line);
    if (!match) {
      return parseFailure('invalid_frontmatter', `Invalid frontmatter syntax on line ${index + 2}.`);
    }

    const key = match[1];
    const rawValue = match[2];
    if (!['description', 'capability', 'model', 'effort', 'tools', 'skills', 'mcp'].includes(key)) {
      return parseFailure('unknown_field', 'Unknown frontmatter field.');
    }
    if (seen.has(key)) {
      return parseFailure('duplicate_field', `Duplicate frontmatter field: ${key}.`);
    }
    seen.add(key);

    if (key === 'tools' || key === 'skills') {
      if (rawValue.trim() !== '') {
        return parseFailure('unsupported_structure', `${key} must use an indented string sequence, not an inline value.`);
      }
      fields[key] = [];
      collecting = key;
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
    fields[key as 'description' | 'capability' | 'model' | 'effort' | 'mcp'] = scalarResult.value;
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
  if (fields.effort !== undefined && !(SUBAGENT_EFFORT_POLICIES as readonly string[]).includes(fields.effort)) {
    return parseFailure('invalid_effort', `effort must be one of: ${SUBAGENT_EFFORT_POLICIES.join(', ')}.`);
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
  if (fields.skills !== undefined) {
    const skillValidation = validateSkillAllowlist(fields.skills);
    if (!skillValidation.ok) {
      return parseFailure(skillValidation.code, skillValidation.message);
    }
  }

  const manifest: CustomSubagentManifest = {
    capability: fields.capability,
    description: fields.description!,
    effort: (fields.effort || 'inherit') as SubagentEffortPolicy,
    instructions: body,
    mcp: fields.mcp === 'true',
    ...(fields.model !== undefined ? {modelProfileId: fields.model} : {}),
    ...(fields.skills !== undefined ? {skillNames: fields.skills} : {}),
    tools: fields.tools!
  };
  return {ok: true, manifest};
}

/** 校验 Skill allowlist 名称的非空、控制字符、长度与重复约束；非法序列使整个定义失效。 */
function validateSkillAllowlist(values: readonly string[]): {ok: true} | {ok: false; code: string; message: string} {
  const seen = new Set<string>();
  for (const value of values) {
    if (value === '' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
      return {ok: false, code: 'invalid_skill', message: `Invalid skill name: ${safeDiagnosticValue(value)}.`};
    }
    if (Array.from(value).length > MAX_CUSTOM_SUBAGENT_SKILL_NAME_CODE_POINTS) {
      return {ok: false, code: 'skill_name_too_long', message: `Skill name exceeds ${MAX_CUSTOM_SUBAGENT_SKILL_NAME_CODE_POINTS} Unicode code points.`};
    }
    if (seen.has(value)) {
      return {ok: false, code: 'duplicate_skill', message: `Duplicate skill name: ${value}.`};
    }
    seen.add(value);
  }
  return {ok: true};
}

/**
 * 把已校验领域对象写成稳定 manifest；字段顺序和 LF 换行固定，Markdown 正文内容不改写。
 */
function serializeCustomSubagentManifest(manifest: Readonly<CustomSubagentManifest>): string {
  const lines = [
    '---',
    `description: ${manifest.description}`,
    `capability: ${manifest.capability}`,
    ...(manifest.modelProfileId ? [`model: ${manifest.modelProfileId}`] : []),
    `effort: ${manifest.effort}`,
    'tools:',
    ...manifest.tools.map((tool) => `  - ${tool}`),
    ...(manifest.skillNames !== undefined ? ['skills:', ...manifest.skillNames.map((skill) => `  - ${skill}`)] : []),
    `mcp: ${String(manifest.mcp)}`,
    '---',
    '',
    manifest.instructions
  ];
  const serialized = `${lines.join('\n')}\n`;
  const reparsed = parseCustomSubagentManifest(serialized);
  if (!reparsed.ok) {
    throw new Error(`Cannot serialize invalid custom subagent manifest: ${reparsed.error.message}`);
  }
  return serialized;
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
  MAX_CUSTOM_SUBAGENT_SKILL_NAME_CODE_POINTS,
  SUBAGENT_EFFORT_POLICIES,
  parseCustomSubagentManifest,
  serializeCustomSubagentManifest,
  validateSkillAllowlist
};

export type {CustomSubagentManifest, CustomSubagentManifestParseError, CustomSubagentManifestParseResult};
