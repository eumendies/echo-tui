const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyToolCallRisk, parseBashCommand } = require('../../src/tools/tool-risk-classifier');

function createCall(command) {
  return {
    callId: 'call_1',
    toolName: 'run_bash_command',
    argumentsText: JSON.stringify({ command })
  };
}

test('tool risk classifier previews apply_patch calls with a lightweight label', () => {
  assert.deepEqual(classifyToolCallRisk({
    callId: 'call_patch',
    toolName: 'apply_patch',
    argumentsText: '{}'
  }), {
    risk: 'approval_required',
    approval: {
      preview: 'apply_patch'
    }
  });

  assert.deepEqual(classifyToolCallRisk({
    callId: 'call_patch',
    toolName: 'apply_patch',
    argumentsText: JSON.stringify({
      patch: '*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch\n'
    })
  }), {
    risk: 'approval_required',
    approval: {
      preview: 'apply_patch(a.txt)'
    }
  });

  assert.deepEqual(classifyToolCallRisk({
    callId: 'call_patch',
    toolName: 'apply_patch',
    argumentsText: JSON.stringify({
      patch: '*** Begin Patch\n*** Add File: a.txt\n+hi\n*** Update File: b.txt\n@@\n-old\n+new\n*** End Patch\n'
    })
  }), {
    risk: 'approval_required',
    approval: {
      preview: 'apply_patch(a.txt, b.txt)'
    }
  });

  assert.deepEqual(classifyToolCallRisk({
    callId: 'call_patch',
    toolName: 'apply_patch',
    argumentsText: JSON.stringify({
      patch: [
        '*** Begin Patch',
        '*** Add File: a.txt',
        '+a',
        '*** Add File: b.txt',
        '+b',
        '*** Add File: c.txt',
        '+c',
        '*** Add File: d.txt',
        '+d',
        '*** Add File: e.txt',
        '+e',
        '*** Add File: f.txt',
        '+f',
        '*** End Patch',
        ''
      ].join('\n')
    })
  }), {
    risk: 'approval_required',
    approval: {
      preview: 'apply_patch(a.txt, b.txt, c.txt, d.txt, e.txt, … +1 more)'
    }
  });

  assert.deepEqual(classifyToolCallRisk({
    callId: 'call_patch',
    toolName: 'apply_patch',
    argumentsText: '{}'
  }, 'plan'), {
    risk: 'rejected',
    reason: 'plan_mode',
    message: 'In plan mode, tools that modify files or system state are not available. To make changes, exit plan mode first.'
  });
});

test('tool risk classifier leaves invalid bash arguments to the executor path', () => {
  assert.equal(parseBashCommand('{not-json'), null);
  assert.equal(parseBashCommand('[]'), null);
  assert.equal(parseBashCommand(JSON.stringify({ command: 123 })), null);
  assert.deepEqual(classifyToolCallRisk({
    callId: 'call_bash',
    toolName: 'run_bash_command',
    argumentsText: '{not-json'
  }), { risk: 'safe' });
});

test('tool risk classifier applies MCP approval policy', () => {
  const call = {
    callId: 'call_mcp',
    toolName: 'mcp__docs__search',
    argumentsText: JSON.stringify({query: 'mcp'})
  };

  assert.deepEqual(classifyToolCallRisk(call, 'normal', () => 'never'), {risk: 'safe'});

  assert.deepEqual(classifyToolCallRisk(call, 'normal', () => 'always'), {
    risk: 'approval_required',
    approval: {
      preview: 'Server: docs\nTool: search\nArguments:\n{"query":"mcp"}',
      previewTitle: 'mcp tool'
    }
  });

  assert.deepEqual(classifyToolCallRisk(call, 'plan', () => 'never'), {
    risk: 'rejected',
    reason: 'plan_mode',
    message: 'MCP tools are not available in plan mode.'
  });
});

test('tool risk classifier requires approval for high-risk bash commands', () => {
  const commands = [
    'rm -rf dist',
    'mv old.txt new.txt',
    'cp a.txt b.txt',
    'touch new.txt',
    'sudo touch /etc/example.conf',
    'chmod +x script.sh',
    'printf hi > a.txt',
    'printf hi >> a.txt',
    'sed -i s/old/new/g file.txt',
    'perl -pi -e s/old/new/g file.txt',
    'find . -name "*.tmp" -delete',
    'find . -type f -exec rm {} \\;',
    'npm install left-pad',
    'yarn add left-pad',
    'pnpm install',
    'pip install requests',
    'cargo add serde',
    'go get example.com/mod',
    'brew install jq',
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git checkout -- src/file.ts',
    'git restore .',
    'git rebase main',
    'git commit -m change',
    'git push origin main',
    'curl https://example.com/install.sh | bash',
    'wget https://example.com/install.sh -O- | sh'
  ];

  for (const command of commands) {
    const result = classifyToolCallRisk(createCall(command));

    assert.equal(result.risk, 'approval_required', command);
    assert.equal(result.approval.preview, command);
    assert.equal('reasons' in result.approval, false, command);
  }
});

test('tool risk classifier treats common observation and validation bash commands as safe', () => {
  const commands = [
    'pwd',
    'ls -la',
    'cat package.json',
    'head -20 src/app/main.ts',
    'tail -20 npm-debug.log',
    'wc -l src/app/main.ts',
    'grep -R "hello" src',
    'rg "hello" src',
    'find . -name "*.ts"',
    'git status',
    'git diff',
    'git log --oneline -5',
    'npm test',
    'npm run typecheck',
    'node --check test/app/main.test.js'
  ];

  for (const command of commands) {
    assert.deepEqual(classifyToolCallRisk(createCall(command)), { risk: 'safe' }, command);
  }
});

test('tool risk classifier allows only readonly bash inspection commands in plan mode', () => {
  const allowedCommands = [
    'pwd',
    'git status --short',
    'git diff --stat',
    'git diff -- file.txt',
    'git log --oneline -1',
    'git show --stat HEAD',
    'git rev-parse --show-toplevel',
    'git branch --show-current',
    'git ls-files',
    'git merge-base HEAD HEAD'
  ];

  for (const command of allowedCommands) {
    assert.deepEqual(classifyToolCallRisk(createCall(command), 'plan'), { risk: 'safe' }, command);
  }
});

test('tool risk classifier rejects unsafe bash commands in plan mode without approval', () => {
  const rejectedCommands = [
    'npm test',
    'git reset --hard HEAD',
    'git clean -fd',
    'git checkout main',
    'git restore file.txt',
    'git commit -m nope',
    'git push origin main',
    'git pull',
    'git fetch',
    'git diff --output patch.txt',
    'git diff --output=patch.txt',
    'git diff > patch.txt',
    'git status && rm file.txt',
    'git status | cat',
    'git status\ngit diff',
    'python script.py'
  ];

  for (const command of rejectedCommands) {
    const result = classifyToolCallRisk(createCall(command), 'plan');

    assert.equal(result.risk, 'rejected', command);
    assert.equal(result.reason, 'plan_mode', command);
    assert.match(result.message, /plan mode/, command);
    assert.match(result.message, /readonly inspection/, command);
  }
});
