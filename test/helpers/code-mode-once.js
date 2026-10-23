/** 只在显式子进程 fixture 模式下启动 CLI，避免默认 test 发现把 helper 当作真实入口。 */
function runCodeModeOnceFixture() {
  const assert = require('node:assert/strict');
  const {createFakeAgent: originalFakeAgent} = require('../../src/agent/fake/agent');
  const fakeAgent = require('../../src/agent/fake/agent');
  const scenario = process.env.ECHO_TEST_CODE_ONCE;

  // 真实 --once 入口必须在管道 stdin 下工作，任何交互式监听都立即暴露为测试失败。
  assert.notEqual(process.stdout.isTTY, true);
  process.stdin.setRawMode = () => { throw new Error('headless entered raw mode'); };
  process.stdin.resume = () => { throw new Error('headless resumed stdin'); };
  for (const method of ['on', 'addListener', 'once']) {
    const original = process.stdin[method];
    process.stdin[method] = function (event, ...args) {
      assert.ok(!['data', 'readable', 'keypress'].includes(event), `headless listens to stdin: ${event}`);
      return original.call(this, event, ...args);
    };
  }

  if (scenario === 'cancel') {
    const readers = require('../../src/tools/read-files/tool-handler');
    const createHandler = readers.createReadFilesToolHandler;
    readers.createReadFilesToolHandler = (...args) => {
      const handler = createHandler(...args);
      return {
        ...handler,
        async executeScript(_args, _call, options) {
          process.stderr.write('INNER_TOOL_STARTED\n');
          await new Promise((resolve) => {
            const timer = setTimeout(done, 2000);
            function done() {
              clearTimeout(timer);
              options.abortSignal.removeEventListener('abort', done);
              resolve();
            }
            options.abortSignal.addEventListener('abort', done, {once: true});
          });
          return {
            schema_version: 1, ok: false, data: null,
            error: {code: 'cancelled', message: 'cancelled'}, truncated: false
          };
        }
      };
    };
  }

  if (scenario !== 'echo') {
    fakeAgent.createFakeAgent = () => {
      let turn = 0;
      return {
        async runTurn(records) {
          if (scenario === 'provider-error') {
            throw new Error('authorization: Bearer sk-local-secret');
          }
          turn += 1;
          if (turn === 1) {
            const code = scenario === 'failure'
              ? 'throw new Error("expected local script failure");'
              : `
                const denied = [];
                for (const name of ['run_bash_command', 'apply_patch', 'edit_file', 'mcp__private__read',
                  'web_fetch', 'web_search', 'ask_user_questions', 'run_subagent', 'run_code']) {
                  try {
                    await tools[name]({});
                  } catch (_) {
                    denied.push(name);
                  }
                }
                const files = await tools.read_files({files: [{path: 'fixture.txt'}]});
                return {denied, lines: files.data.files[0].returned_lines};
              `;
            const calls = [{
              callId: 'once-code',
              toolName: 'run_code',
              argumentsText: JSON.stringify({code})
            }];
            if (scenario === 'approval') {
              calls.unshift({
                callId: 'once-write',
                toolName: 'apply_patch',
                argumentsText: JSON.stringify({patch: '*** Begin Patch\n*** Add File: approved.txt\n+approved\n*** End Patch'})
              });
            }
            return {draft: '', toolCalls: calls};
          }
          assert.equal(turn, 2, '脚本不得自动重跑');
          const calls = records.filter((record) => record.role === 'tool_call');
          const results = records.filter((record) => record.role === 'tool_result');
          assert.deepEqual(calls.map((record) => record.toolCallId), results.map((record) => record.toolCallId));
          assert.ok(!records.some((record) => record.role === 'code_execution'));
          assert.ok(!JSON.stringify(records).includes('PRIVATE_FILE_BODY'));
          assert.ok(!JSON.stringify(records).includes('scriptResult'));
          const outer = results.find((record) => record.toolName === 'run_code');
          const write = results.find((record) => record.toolName === 'apply_patch');
          return {
            draft: JSON.stringify({outer: JSON.parse(outer.text), writeAllowed: write?.ok ?? null}),
            toolCalls: []
          };
        }
      };
    };
  } else {
    fakeAgent.createFakeAgent = originalFakeAgent;
  }

  // 不调用测试版 runOnce：让真实 CLI 解析、bootstrap、配置、hooks 与资源清理共同运行。
  const {runCli} = require('../../src/cli/main');
  void runCli().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

if (require.main === module && process.env.ECHO_TEST_CODE_ONCE) {
  runCodeModeOnceFixture();
}
