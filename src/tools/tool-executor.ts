import type {ToolCall, ToolExecutionOptions, ToolExecutionResult, ToolExecutor, ToolRegistry} from '../types/tool';

/**
 * 创建 provider-neutral 工具执行器，统一处理工具查找、参数解析和失败归一化。
 */
function createToolExecutor(registry: ToolRegistry): ToolExecutor {
  return {
    async execute(call: ToolCall, options?: ToolExecutionOptions): Promise<ToolExecutionResult> {
      const handler = registry.getHandler(call.toolName);

      if (!handler) {
        return createFailureResult(call, `Unknown tool: ${call.toolName}`);
      }

      const args = parseArguments(call.argumentsText);

      if (!args.ok) {
        return createFailureResult(call, args.message);
      }

      try {
        return await handler.execute(args.value, call, options);
      } catch (error: unknown) {
        const message = error instanceof Error && error.message.trim() !== '' ? error.message : 'Tool execution failed';
        return createFailureResult(call, message);
      }
    }
  };
}

/**
 * 解析模型给出的 function arguments；这里是 provider 输入边界，只接受 JSON object。
 */
function parseArguments(argumentsText: string): {ok: true; value: Record<string, unknown>} | {ok: false; message: string} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return {
      ok: false,
      message: 'Tool arguments are not valid JSON'
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      message: 'Tool arguments must be a JSON object'
    };
  }

  return {
    ok: true,
    value: parsed as Record<string, unknown>
  };
}

/**
 * 把未知工具、参数错误或 handler 异常转成模型可消费的 tool result。
 */
function createFailureResult(call: ToolCall, message: string): ToolExecutionResult {
  return {
    callId: call.callId,
    toolName: call.toolName,
    ok: false,
    text: message
  };
}

export {
  createToolExecutor
};
