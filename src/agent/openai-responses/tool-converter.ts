import type {ToolCall, ToolDefinition} from '../../types/tool';

export type OpenAiFunctionTool = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

type FunctionCallDoneEvent = {
  type?: unknown;
  arguments?: unknown;
  call_id?: unknown;
  item?: unknown;
  name?: unknown;
};

const OPENAI_UNSUPPORTED_SCHEMA_KEYWORDS = new Set(['$schema', 'default', 'format']);

/**
 * 把 provider-neutral 工具定义投影成 OpenAI Responses function tool schema。
 */
function convertToolDefinitionsToOpenAiTools(definitions: ToolDefinition[], options: {strict?: boolean} = {strict: true}): OpenAiFunctionTool[] {
  return definitions.map((definition) => ({
    type: 'function',
    name: definition.name,
    description: definition.description,
    parameters: convertParametersToOpenAiStrictSchema(definition.parameters),
    ...(options.strict !== undefined ? {strict: options.strict} : {})
  }));
}

/**
 * Responses strict function schema 要求每个 object 关闭额外属性，且所有 properties 都出现在 required 中。
 */
function convertParametersToOpenAiStrictSchema(parameters: Record<string, unknown>): Record<string, unknown> {
  return convertSchemaNode(parameters) as Record<string, unknown>;
}

function convertSchemaNode(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(convertSchemaNode);
  }

  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const converted: Record<string, unknown> = {};
  const originalRequired = Array.isArray((schema as Record<string, unknown>).required)
    ? new Set((schema as {required: unknown[]}).required.filter((value): value is string => typeof value === 'string'))
    : new Set<string>();

  for (const [key, value] of Object.entries(schema)) {
    if (OPENAI_UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      continue;
    }

    converted[key] = key === 'properties' ? convertSchemaProperties(value) : convertSchemaNode(value);
  }

  const properties = converted.properties;

  if (isObjectSchema(converted)) {
    converted.additionalProperties = false;
  }

  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const propertySchemas = properties as Record<string, unknown>;

    for (const [propertyName, propertySchema] of Object.entries(propertySchemas)) {
      if (!originalRequired.has(propertyName)) {
        propertySchemas[propertyName] = allowNullSchema(propertySchema);
      }
    }

    converted.required = Object.keys(propertySchemas);
  }

  return converted;
}

function convertSchemaProperties(properties: unknown): unknown {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return convertSchemaNode(properties);
  }

  return Object.fromEntries(Object.entries(properties).map(([propertyName, propertySchema]) => [propertyName, convertSchemaNode(propertySchema)]));
}

function isObjectSchema(schema: Record<string, unknown>): boolean {
  const schemaType = schema.type;
  return schemaType === 'object' || (Array.isArray(schemaType) && schemaType.includes('object')) || Boolean(schema.properties);
}

function allowNullSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const converted = {...schema as Record<string, unknown>};
  const schemaType = converted.type;

  if (Array.isArray(schemaType)) {
    converted.type = schemaType.includes('null') ? schemaType : [...schemaType, 'null'];
  } else if (typeof schemaType === 'string') {
    converted.type = [schemaType, 'null'];
  }

  if (Array.isArray(converted.enum) && !converted.enum.includes(null)) {
    converted.enum = [...converted.enum, null];
  }

  return converted;
}

/**
 * 从 OpenAI stream 事件中提取完整 function call；只接受带 call_id 的完成态事件。
 */
function extractFunctionToolCall(event: unknown): ToolCall | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const candidate = event as FunctionCallDoneEvent;

  if (candidate.type === 'response.output_item.done') {
    // output_item.done 通常包含完整 function_call item，是最可靠的 call_id 来源。
    return extractFunctionToolCallFromItem(candidate.item);
  }

  if (candidate.type !== 'response.function_call_arguments.done') {
    return null;
  }

  const itemCall = extractFunctionToolCallFromItem(candidate.item);

  if (itemCall) {
    return itemCall;
  }

  if (typeof candidate.name !== 'string' || typeof candidate.arguments !== 'string') {
    return null;
  }

  const callId = typeof candidate.call_id === 'string' ? candidate.call_id : '';

  if (callId === '') {
    // function_call_arguments.done 可能只有 item_id；item_id 不能冒充 Responses call_id。
    return null;
  }

  return {
    callId,
    toolName: candidate.name,
    argumentsText: candidate.arguments
  };
}

/**
 * 从完整 output item 中读取 function_call，过滤非工具 item 和缺字段的 partial item。
 */
function extractFunctionToolCallFromItem(item: unknown): ToolCall | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const candidate = item as {arguments?: unknown; call_id?: unknown; name?: unknown; type?: unknown};

  if (
    candidate.type !== 'function_call' ||
    typeof candidate.call_id !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.arguments !== 'string'
  ) {
    return null;
  }

  return {
    callId: candidate.call_id,
    toolName: candidate.name,
    argumentsText: candidate.arguments
  };
}

export {
  convertToolDefinitionsToOpenAiTools,
  extractFunctionToolCall
};
