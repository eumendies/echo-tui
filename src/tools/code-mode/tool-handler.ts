import {executeCode, isCodeRuntimeAvailable} from './execution';
import {SCRIPT_API_DESCRIPTION} from './contracts';
import type {CodeResult} from './protocol';
import type {ToolHandler} from '../../types/tool';

export const RUN_CODE_TOOL_NAME = 'run_code';

/** 只由主运行注册；实际内部能力必须由 loop 的执行前策略边界逐次提供。 */
export function createRunCodeToolHandler(): ToolHandler {
  return {
    definition: {
      name: RUN_CODE_TOOL_NAME,
      description:
        'Optional JavaScript orchestration for local read-only tools. Prefer native tools for simple tasks. Code ' +
        'is an async function BODY; use await and return. No Node/process/require/import/fs/network, npm, state, ' +
        'edits, MCP or subagents. Return JSON only (undefined=>null); await ALL tool calls before returning. ' +
        'Inspect ok/error and has_more; never assume truncated data is complete. Limits: source/arguments 32KiB; ' +
        'heap 32MiB; active CPU 1000ms; wall 30s; 16 attempts; concurrency 2; responses 64KiB each/512KiB total; ' +
        'final JSON 16KiB; logs 32 entries/8KiB. Heap allocation errors may be caught without raising the heap cap; ' +
        'uncaught memory errors fail execution. Other fatal limits/cancellation close dispatch permanently.\n' +
        SCRIPT_API_DESCRIPTION +
        '\nSuccess: const r = await tools.glob({pattern:\'src/**/*.ts\'}); if (!r.ok) return {error:r.error}; return ' +
        '{count:r.data.paths.length,incomplete:r.data.has_more};\nFailure recovery: const r = await ' +
        'tools.read_files({files:[{path:\'missing.txt\'}]}); if (!r.ok) return {error:r.error,files:r.data ? ' +
        'r.data.files : []}; return r.data;',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Single async function body; await tools.* and return a bounded JSON value.'
          }
        },
        required: ['code'],
        additionalProperties: false
      }
    },
    async execute(args, call, options) {
      const invalid = Object.keys(args).some((key) => key !== 'code') || typeof args.code !== 'string';
      let error: string | null = null;

      if (invalid) {
        error = 'invalid_arguments';
      } else if (!isCodeRuntimeAvailable()) {
        error = 'runtime_unavailable';
      } else if (!options?.codeDispatch) {
        error = 'policy_unavailable';
      }

      let result: CodeResult;

      if (error) {
        result = {
          status: 'failed',
          result: null,
          logs: [],
          logs_truncated: false,
          summary: {
            attempted: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            duration_ms: 0
          },
          error: {
            code: error,
            message:
              error === 'invalid_arguments' ? 'Expected only {code: string}' : 'Code Mode runtime or policy boundary is unavailable',
            phase: 'runtime'
          }
        };
      } else {
        result = await executeCode({
          code: args.code as string,
          callId: call.callId,
          signal: options?.abortSignal,
          dispatch: options!.codeDispatch!,
          onAudit: options?.onCodeAudit
        });
      }

      return {
        callId: call.callId,
        toolName: call.toolName,
        details: {kind: 'generic'},
        ok: result.status === 'succeeded',
        text: JSON.stringify(result)
      };
    }
  };
}
