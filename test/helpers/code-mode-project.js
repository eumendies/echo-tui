const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agentSetup = require('../../src/agent/agent-setup');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {createDefaultUserConfig} = require('../../src/config/user-setup-bootstrap');
const {createAgentLoopRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
const {createCompositeObservation, disabledObservation} = require('../../src/observation/observation');
const {createObservation} = require('../../src/observation/observation-projector');

/** 保留真实 snapshot、registry、executor 与隔离执行，只替换离线 provider。 */
async function withCodeModeProject(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-code-loop-'));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  fs.mkdirSync(path.join(home, '.echo'), {recursive: true});
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'one.txt'), 'PRIVATE_FILE_BODY\nneedle\n');
  fs.writeFileSync(path.join(cwd, 'two.txt'), 'other\n');
  const configPath = path.join(home, '.echo', 'config.json');
  const config = {
    ...createDefaultUserConfig(),
    tools: {codeMode: {enabled: true}},
    mcp: {enabled: false}
  };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const originalHomedir = os.homedir;
  const originalPrepareAgent = agentSetup.prepareAgent;
  os.homedir = () => home;
  const context = new UserConfigContext({configPath});
  const debugEvents = [];
  const hookEvents = [];
  const lifecycle = [];
  const preparations = [];
  const debug = {
    enabled: true,
    logPath: null,
    emit(event, payload) { debugEvents.push({event, payload}); },
    close() {}
  };
  const hooks = {
    emit(event, payload) { hookEvents.push({event, payload}); },
    async flush() {},
    updateConfig() {}
  };
  const observation = createCompositeObservation([
    createObservation(debug, hooks),
    {
      ...disabledObservation,
      toolStarted(input) { lifecycle.push({event: 'start', ...input}); },
      toolCompleted(input) { lifecycle.push({event: 'end', ...input}); }
    }
  ]);
  const fixture = {
    config,
    context,
    configPath,
    cwd,
    home,
    root,
    debugEvents,
    hookEvents,
    lifecycle,
    preparations,
    observation,
    allowedToolNames: undefined,
    decorateRegistry: undefined,
    createProvider: () => ({async runTurn() { return {draft: 'done', toolCalls: []}; }}),
    refresh() {
      fs.writeFileSync(configPath, JSON.stringify(config));
      return context.refresh();
    }
  };
  agentSetup.prepareAgent = (options) => {
    const prepared = originalPrepareAgent({
      ...options,
      ...(fixture.allowedToolNames ? {allowedToolNames: fixture.allowedToolNames} : {})
    });
    if (fixture.decorateRegistry) {
      prepared.registry = fixture.decorateRegistry(prepared.registry);
    }
    preparations.push({...prepared, options});
    return {...prepared, agent: fixture.createProvider(prepared, options)};
  };
  fixture.run = createAgentLoopRuntime(cwd, context, undefined, observation);
  try {
    return await callback(fixture);
  } finally {
    agentSetup.prepareAgent = originalPrepareAgent;
    os.homedir = originalHomedir;
    context.close();
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function codeCall(code, callId = 'outer-code') {
  return {callId, toolName: 'run_code', argumentsText: JSON.stringify({code})};
}

/** 离线 provider 只声明一次工具，第二轮保留真实 continuation 供协议断言。 */
function toolProvider(calls, requests = []) {
  let turn = 0;
  return {
    async runTurn(records) {
      requests.push(structuredClone(records));
      turn += 1;
      return turn === 1 ? {draft: '', toolCalls: calls} : {draft: 'done', toolCalls: []};
    }
  };
}

module.exports = {withCodeModeProject, codeCall, toolProvider};
