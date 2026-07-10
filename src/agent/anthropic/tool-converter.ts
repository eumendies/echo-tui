import type {ToolDefinition} from '../../types/tool';

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/**
 * 把 provider-neutral 工具定义投影成 Anthropic Messages API tool schema。
 */
function convertToolDefinitionsToAnthropicTools(definitions: ToolDefinition[]): AnthropicTool[] {
  return definitions.map((definition) => ({
    name: definition.name,
    description: definition.description,
    input_schema: definition.parameters
  }));
}

export {convertToolDefinitionsToAnthropicTools};
