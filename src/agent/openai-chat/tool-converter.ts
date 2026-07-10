import type {ToolDefinition} from '../../types/tool';

export type OpenAiChatFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * 把 provider-neutral 工具定义投影成 Chat Completions function tool schema。
 */
function convertToolDefinitionsToOpenAiChatTools(definitions: ToolDefinition[]): OpenAiChatFunctionTool[] {
  return definitions.map((definition) => ({
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters
    }
  }));
}

export {convertToolDefinitionsToOpenAiChatTools};
