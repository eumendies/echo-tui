import {capUtf8Text} from '../tool-handler-utils';
import type {Result} from '../tool-handler-utils';

export const SCRIPT_TOOL_NAMES = ['glob', 'grep', 'read_files'] as const;
export type ScriptToolName = (typeof SCRIPT_TOOL_NAMES)[number];
export const SCRIPT_TOOL_MAX_RESPONSE_BYTES = 65_536;
export const SCRIPT_TOOL_ERROR_CODES = [
  'invalid_arguments',
  'tool_failed',
  'cancelled',
  'partial_failure',
  'unsupported_type',
  'read_failed',
  'invalid_encoding',
  'result_limit_exceeded',
  'contract_error'
] as const;
export type ScriptToolErrorCode = (typeof SCRIPT_TOOL_ERROR_CODES)[number];

export type ScriptToolError = {
  code: ScriptToolErrorCode; // 稳定错误分类，供脚本有限恢复或执行器终止派发。
  message: string; // 有界诊断，不含堆栈。
};

export type ScriptGrepMatch = {
  path: string; // 保留原生路径口径与采集顺序。
  line: number; // 源文件中从一开始的行号。
  column: number; // 从一开始的 UTF-8 字节列，而非 JS 字符索引。
  text: string; // 完整源行，不含展示前缀和末尾换行。
};

export type ScriptTextFile = {
  path: string; // 请求中的原始文件路径。
  ok: true; // 此项已通过普通 UTF-8 文本检查。
  kind: 'text'; // 脚本通道只允许文本成功项。
  content: string; // LF 归一化的选中内容，无展示行号。
  offset: number; // 从零开始跳过的源行数。
  returned_lines: number; // 返回的逻辑行数，可能包含末尾的不完整行。
  start_line: number | null; // 第一条返回源行的一基行号，空内容范围为 null。
  end_line: number | null; // 最后一条返回源行的一基行号。
  has_more: boolean; // 仍有或可能有未读内容。
  content_truncated: boolean; // 内容因字节或 JSON 预算不完整。
  next_offset: number | null; // 仅能在完整行边界安全续读时提供。
  total_lines?: number; // 仅完整扫描到 EOF 时存在。
};

export type ScriptFileError = {
  path: string; // 请求中的原始路径，维持逐项顺序。
  ok: false; // 此项失败不抹掉同批其他成功项。
  kind: 'error'; // 与文本成功项区分的判别字段。
  error: ScriptToolError; // 不调用多媒体 reader 的结构化诊断。
};

export type ScriptToolData =
  | {
      paths: string[]; // 实际保留的完整路径项。
      has_more: boolean; // 结果可能不完整。
    }
  | {
      matches: ScriptGrepMatch[]; // 实际保留的完整匹配项。
      has_more: boolean; // 结果可能不完整。
    }
  | {
      files: Array<ScriptTextFile | ScriptFileError>; // 按请求顺序保留的逐文件结果。
    };

export type ScriptToolEnvelope = {
  schema_version: 1; // 固定契约版本，不随原生展示变化。
  ok: boolean; // 所有请求项均成功才为 true。
  data: ScriptToolData | null; // 工具数据；全局失败时为 null，部分失败仍保留数据。
  error: ScriptToolError | null; // 成功为 null，失败使用稳定错误码。
  truncated: boolean; // 预算导致的信息缺失，不等同于正常 limit 分页。
};

type Schema = {
  type?: string | string[]; // JSON 值类别，可空字段显式包含 null。
  const?: unknown; // 判别字段的唯一合法值。
  enum?: readonly unknown[]; // 有限稳定取值。
  properties?: Record<string, Schema>; // 允许的对象字段。
  required?: string[]; // 必须显式提供的字段。
  additionalProperties?: false; // 跨信任边界拒绝未声明字段。
  items?: Schema; // 数组元素契约。
  minItems?: number; // 非空请求数组的下限。
  maxItems?: number; // 与原生单次文件数保持一致。
  minimum?: number; // 行号与分页参数的数值下限。
  pattern?: string; // 非空语义字符串约束。
  anyOf?: Schema[]; // envelope 与逐文件结果的互斥结构。
  description?: string; // 用于生成模型可见的简短说明。
};
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});
const string: Schema = {type: 'string'};
const nonempty: Schema = {
  type: 'string',
  pattern: '^(?=[\\s\\S]*\\S)[^\\u0000]*$'
};
const boolean: Schema = {type: 'boolean'};
const nullableInteger: Schema = {
  type: ['integer', 'null'],
  minimum: 1
};
const errorSchema = object({
  code: {enum: SCRIPT_TOOL_ERROR_CODES},
  message: string
});
const paths: Schema = {
  type: ['array', 'null'],
  minItems: 1,
  items: nonempty,
  description: 'null/omitted => current cwd; absolute and .. allowed; .git forbidden'
};
const fileSuccessSchema = object(
  {
    path: string,
    ok: {const: true},
    kind: {const: 'text'},
    content: string,
    offset: {
      type: 'integer',
      minimum: 0
    },
    returned_lines: {
      type: 'integer',
      minimum: 0
    },
    start_line: nullableInteger,
    end_line: nullableInteger,
    has_more: boolean,
    content_truncated: boolean,
    next_offset: {
      type: ['integer', 'null'],
      minimum: 0
    },
    total_lines: {
      type: 'integer',
      minimum: 0
    }
  },
  ['path', 'ok', 'kind', 'content', 'offset', 'returned_lines', 'start_line', 'end_line', 'has_more', 'content_truncated', 'next_offset']
);
const fileErrorSchema = object({
  path: string,
  ok: {const: false},
  kind: {const: 'error'},
  error: errorSchema
});
function outputSchema(data: Schema, partial = false): Schema {
  const schema = object({
    schema_version: {const: 1},
    ok: boolean,
    data: {anyOf: [data, {type: 'null'}]},
    error: {anyOf: [errorSchema, {type: 'null'}]},
    truncated: boolean
  });
  schema.anyOf = [
    {
      properties: {
        ok: {const: true},
        data,
        error: {type: 'null'}
      }
    },
    {
      properties: {
        ok: {const: false},
        data: {type: 'null'},
        error: errorSchema
      }
    },
    ...(partial
      ? [
        {
          properties: {
            ok: {const: false},
            data,
            error: object({
              code: {const: 'partial_failure'},
              message: string
            })
          }
        }
      ]
      : [])
  ];
  return schema;
}
const inputs: Record<ScriptToolName, Schema> = {
  glob: object(
    {
      pattern: nonempty,
      paths
    },
    ['pattern']
  ),
  grep: object(
    {
      pattern: nonempty,
      paths,
      glob: {
        ...nonempty,
        type: ['string', 'null']
      },
      literal: {
        type: ['boolean', 'null'],
        description: 'null/omitted => true; false enables regex'
      },
      case_sensitive: {
        type: ['boolean', 'null'],
        description: 'null/omitted => ripgrep default'
      }
    },
    ['pattern']
  ),
  read_files: object({
    files: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: object(
        {
          path: nonempty,
          offset: {
            type: ['integer', 'null'],
            minimum: 0,
            description: 'zero-based skipped lines; null/omitted => 0'
          },
          limit: {
            type: ['integer', 'null'],
            minimum: 1,
            description: 'null/omitted => remaining lines, within budgets'
          }
        },
        ['path']
      )
    }
  })
};
const outputs: Record<ScriptToolName, Schema> = {
  glob: outputSchema(
    object({
      paths: {
        type: 'array',
        items: string
      },
      has_more: boolean
    })
  ),
  grep: outputSchema(
    object({
      matches: {
        type: 'array',
        items: object({
          path: string,
          line: {
            type: 'integer',
            minimum: 1
          },
          column: {
            type: 'integer',
            minimum: 1
          },
          text: string
        })
      },
      has_more: boolean
    })
  ),
  read_files: outputSchema(
    object({
      files: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {anyOf: [fileSuccessSchema, fileErrorSchema]}
      }
    }),
    true
  )
};
const notes: Record<ScriptToolName, string> = {
  glob: 'Complete paths only; hidden files included, .git excluded. has_more/truncated: narrow pattern/paths; no cursor or total.',
  grep: 'Complete source-line matches only. line is 1-based; column is 1-based UTF-8 bytes, NOT a JS character index. No matches succeeds. has_more/truncated: narrow query.',
  read_files:
    'Regular UTF-8 text only, no directory/image/PDF/media/special files. LF-normalized content, no display line numbers. Ordered per-file errors preserve successes; top-level partial_failure. start_line/end_line null when no lines. total_lines only after EOF. Normal limit pagination has_more with next_offset, not truncated. Partial source line: content_truncated=true, next_offset=null (no byte continuation; use native tool or narrow task).'
};
function describe(schema: Schema): string {
  if (schema.anyOf && !schema.properties) {
    return schema.anyOf.map(describe).join('|');
  }
  if ('const' in schema) {
    return JSON.stringify(schema.const);
  }
  if (schema.enum) {
    return schema.enum.join('|');
  }
  if (schema.properties) {
    return `{${Object.entries(schema.properties)
      .map(([key, field]) => `${key}${schema.required?.includes(key) ? '' : '?'}:${describe(field)}`)
      .join(',')}}`;
  }
  const type = Array.isArray(schema.type) ? schema.type.join('|') : schema.type;
  const bounds = [
    schema.minimum === undefined ? '' : `>=${schema.minimum}`,
    schema.minItems === undefined ? '' : `minItems=${schema.minItems}`,
    schema.maxItems === undefined ? '' : `maxItems=${schema.maxItems}`,
    schema.pattern ? 'nonblank, no NUL' : ''
  ]
    .filter(Boolean)
    .join('; ');
  return `${schema.items ? `[${describe(schema.items)}]${Array.isArray(schema.type) ? '|null' : ''}` : type}${bounds ? ` (${bounds})` : ''}${schema.description ? ` (${schema.description})` : ''}`;
}
export const SCRIPT_TOOL_CONTRACTS = Object.fromEntries(
  SCRIPT_TOOL_NAMES.map((name) => [
    name,
    {
      inputSchema: inputs[name],
      outputSchema: outputs[name],
      description: `tools.${name}(${describe(inputs[name])}) => ${describe(outputs[name])}. ${notes[name]}`
    }
  ])
) as Record<
  ScriptToolName,
  {
    inputSchema: Schema; // 输入的唯一维护 schema。
    outputSchema: Schema; // 输出的唯一维护 schema。
    description: string; // 从 schema 与语义说明生成的 API 文本。
  }
>;
export const SCRIPT_API_DESCRIPTION = `${SCRIPT_TOOL_NAMES.map((name) => SCRIPT_TOOL_CONTRACTS[name].description).join('\n')}\nAll envelopes: schema_version=1; ok iff all items succeed; error={code,message}|null; data=null on global failure. Full JSON envelope <=65536 UTF-8 bytes; budgets keep whole items. Ordinary tool errors may be checked; cancelled/contract_error are execution-level failures.`;

/** 拒绝 JSON 会静默丢失或执行的宿主值；桥接之外直接调用也不能绕过纯数据边界。 */
function checkJson(value: unknown, ancestors = new Set<object>(), depth = 0): string | undefined {
  if (depth > 32) {
    return 'JSON nesting exceeds 32 levels';
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : 'JSON numbers must be finite';
  }
  if (typeof value !== 'object') {
    return 'value must contain only JSON data';
  }
  if (ancestors.has(value)) {
    return 'JSON data must not be cyclic';
  }
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return 'value must be a JSON object';
  }
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) {
    return 'JSON arrays must be dense and have no extra properties';
  }
  for (const key of keys) {
    if (array && key === 'length') {
      continue;
    }
    if (typeof key !== 'string') {
      return 'JSON data must not have symbol keys';
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      return 'JSON data must not contain accessors or hidden properties';
    }
    const reason = checkJson(descriptor.value, ancestors, depth + 1);
    if (reason) {
      return reason;
    }
  }
  ancestors.delete(value);
  return undefined;
}

/** 仅实现本模块维护的 schema 关键字，避免引入运行时依赖或宽松 coercion。 */
function check(schema: Schema, value: unknown, field = 'value'): string | undefined {
  if (schema.anyOf && !schema.anyOf.some((option) => check(option, value) === undefined)) {
    return `${field} does not match any allowed shape`;
  }
  if ('const' in schema && value !== schema.const) {
    return `${field} must equal ${JSON.stringify(schema.const)}`;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${field} has an unknown value`;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      !types.some((type) => {
        switch (type) {
          case 'null':
            return value === null;
          case 'array':
            return Array.isArray(value);
          case 'object':
            return !!value && typeof value === 'object' && !Array.isArray(value);
          case 'integer':
            return typeof value === 'number' && Number.isSafeInteger(value);
          default:
            return typeof value === type;
        }
      })
    ) {
      return `${field} must be ${types.join('|')}`;
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    return `${field} must be >= ${schema.minimum}`;
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    return `${field} must be non-empty`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `${field} must not be empty`;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `${field} exceeds ${schema.maxItems} entries`;
    }
    if (schema.items) {
      for (const [index, item] of value.entries()) {
        const error = check(schema.items, item, `${field}[${index}]`);
        if (error) {
          return error;
        }
      }
    }
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Object.getPrototypeOf(record) !== Object.prototype && Object.getPrototypeOf(record) !== null) {
      return `${field} must be a JSON object`;
    }
    for (const key of schema.required || []) {
      if (!Object.hasOwn(record, key)) {
        return `${field}.${key} is required`;
      }
    }
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(schema.properties, key)) {
        if (schema.additionalProperties === false) {
          return `${field}.${key} is not allowed`;
        }
        continue;
      }
      const error = check(schema.properties[key], record[key], `${field}.${key}`);
      if (error) {
        return error;
      }
    }
  }
  return undefined;
}

export function validateScriptInput(name: ScriptToolName, args: unknown): Result<Record<string, unknown>> {
  if (!SCRIPT_TOOL_NAMES.includes(name)) {
    return {
      ok: false,
      reason: 'unknown script tool'
    };
  }
  const reason = checkJson(args) || check(inputs[name], args, 'args');
  if (reason) {
    return {
      ok: false,
      reason
    };
  }
  const value = {...(args as Record<string, unknown>)};
  // 可空参数沿用原生默认值；路径权限仍由共享归一化器按真实 cwd 检查。
  if (name === 'read_files') {
    value.files = (value.files as Record<string, unknown>[]).map((file) => ({
      path: file.path,
      offset: file.offset ?? 0,
      ...(file.limit == null ? {} : {limit: file.limit})
    }));
  } else {
    value.paths ??= ['.'];
    if (name === 'grep') {
      value.literal ??= true;
      if (value.glob == null) {
        delete value.glob;
      }
      if (value.case_sensitive == null) {
        delete value.case_sensitive;
      }
    }
  }
  return {
    ok: true,
    value
  };
}

export function validateScriptEnvelope(name: ScriptToolName, envelope: unknown): Result<ScriptToolEnvelope> {
  if (!SCRIPT_TOOL_NAMES.includes(name)) {
    return {
      ok: false,
      reason: 'unknown script tool'
    };
  }
  const reason = checkJson(envelope) || check(outputs[name], envelope, 'envelope');
  if (reason) {
    return {
      ok: false,
      reason
    };
  }
  const value = envelope as ScriptToolEnvelope;
  if (value.ok !== (value.error === null) || (value.ok && value.data === null)) {
    return {
      ok: false,
      reason: 'inconsistent success/error/data'
    };
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > SCRIPT_TOOL_MAX_RESPONSE_BYTES) {
    return {
      ok: false,
      reason: 'envelope exceeds JSON byte budget'
    };
  }
  if (value.data && 'files' in value.data) {
    if (value.ok !== value.data.files.every((file) => file.ok)) {
      return {
        ok: false,
        reason: 'inconsistent per-file success'
      };
    }
    for (const file of value.data.files) {
      if (file.ok) {
        const contentLines = file.content === '' ? (file.returned_lines > 0 ? 1 : 0) : file.content.split('\n').length;
        if (
          file.returned_lines !== contentLines ||
          (file.returned_lines === 0) !== (file.start_line === null && file.end_line === null) ||
          (file.returned_lines > 0 && (file.start_line !== file.offset + 1 || file.end_line !== file.offset + file.returned_lines)) ||
          (!file.has_more && file.next_offset !== null) ||
          (file.next_offset !== null && file.next_offset !== file.offset + file.returned_lines) ||
          (file.has_more && !file.content_truncated && file.next_offset === null) ||
          (file.total_lines !== undefined &&
            ((file.has_more && !file.content_truncated) || file.total_lines < (file.returned_lines > 0 ? file.end_line! : 0))) ||
          (file.content_truncated && (!file.has_more || !value.truncated))
        ) {
          return {
            ok: false,
            reason: 'inconsistent text pagination'
          };
        }
      }
    }
  } else if (value.data && 'has_more' in value.data && value.data.has_more !== value.truncated) {
    return {
      ok: false,
      reason: 'inconsistent list truncation'
    };
  }
  return {
    ok: true,
    value
  };
}

export function scriptFailure(code: ScriptToolErrorCode, message: string, truncated = false): ScriptToolEnvelope {
  return {
    schema_version: 1,
    ok: false,
    data: null,
    error: {
      code,
      message: capUtf8Text(message, 1024).text
    },
    truncated
  };
}
/** 投影后再次校验，以明确 contract_error 代替不合法的机器结果。 */
export function checkedScriptEnvelope(name: ScriptToolName, envelope: ScriptToolEnvelope): ScriptToolEnvelope {
  const checked = validateScriptEnvelope(name, envelope);
  return checked.ok ? checked.value : scriptFailure('contract_error', checked.reason);
}
/** 逐项移除尾项；绝不裁断路径、匹配项或序列化 JSON。 */
export function projectScriptList(
  name: 'glob' | 'grep',
  items: string[] | ScriptGrepMatch[],
  hasMore: boolean,
  truncated: boolean
): ScriptToolEnvelope {
  const retained = items.slice();
  let envelope: ScriptToolEnvelope;
  do {
    envelope = {
      schema_version: 1,
      ok: true,
      data:
        name === 'glob'
          ? {
            paths: retained as string[],
            has_more: hasMore
          }
          : {
            matches: retained as ScriptGrepMatch[],
            has_more: hasMore
          },
      error: null,
      truncated
    };
    if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') <= SCRIPT_TOOL_MAX_RESPONSE_BYTES) {
      return checkedScriptEnvelope(name, envelope);
    }
    retained.pop();
    hasMore = true;
    truncated = true;
  } while (retained.length > 0);
  return scriptFailure('result_limit_exceeded', 'A result item exceeds the JSON envelope budget', true);
}
