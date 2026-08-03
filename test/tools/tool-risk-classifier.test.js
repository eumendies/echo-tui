const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyReadonlyToolCall, classifyToolCallRisk, parseBashCommand } = require('../../src/tools/tool-risk-classifier');

test('readonly tool policy keeps explicit observations and rejects all other tools', () => {
  const call = (toolName, argumentsText = '{}') => ({callId: `call-${toolName}`, toolName, argumentsText});

  for (const toolName of ['read_files', 'glob', 'grep', 'web_fetch', 'web_search', 'use_skill', 'create_todos', 'complete_todo']) {
    assert.deepEqual(classifyReadonlyToolCall(call(toolName)), {risk: 'safe'});
  }
  assert.deepEqual(classifyReadonlyToolCall(call('run_bash_command', '{"command":"git status --short"}')), {risk: 'safe'});

  for (const toolName of ['apply_patch', 'edit_file', 'ask_user_questions', 'mcp__server__read', 'unknown']) {
    const result = classifyReadonlyToolCall(call(toolName));
    assert.equal(result.risk, 'rejected');
    assert.equal(result.reason, 'readonly_policy');
  }
  assert.equal(classifyReadonlyToolCall(call('run_bash_command', '{"command":"npm test"}')).risk, 'rejected');
  assert.equal(classifyReadonlyToolCall(call('run_bash_command', 'not-json')).risk, 'rejected');
});

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
      patch: '*** Begin Patch\n*** Delete File: old.txt\n*** End Patch\n'
    })
  }), {
    risk: 'approval_required',
    approval: {
      preview: 'apply_patch(delete old.txt)'
    }
  });

  assert.deepEqual(classifyToolCallRisk({
    callId: 'call_patch',
    toolName: 'apply_patch',
    argumentsText: JSON.stringify({
      patch: 'diff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n'
    })
  }), {
    risk: 'approval_required',
    approval: {
      preview: 'apply_patch(delete old.txt)'
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
        '*** Delete File: removed.txt',
        '*** End Patch',
        ''
      ].join('\n')
    })
  }), {
    risk: 'approval_required',
    approval: {
      preview: 'apply_patch(a.txt, b.txt, c.txt, d.txt, delete removed.txt, … +1 more)'
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

test('tool risk classifier treats edit_file as an approval-required write tool', () => {
  const call = {
    callId: 'call_edit',
    toolName: 'edit_file',
    argumentsText: JSON.stringify({path: 'src/a.ts', old_string: 'secret old text', new_string: 'secret new text', replace_all: true})
  };

  assert.deepEqual(classifyToolCallRisk(call), {
    risk: 'approval_required',
    approval: {preview: 'edit_file(src/a.ts, replace all)'}
  });
  assert.doesNotMatch(classifyToolCallRisk(call).approval.preview, /secret/);
  assert.deepEqual(classifyToolCallRisk(call, 'plan'), {
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

test('agent-memory script follows generic bash risk and plan policies', () => {
  const command = "node '/package/dist/src/skills/builtin/agent-memory/scripts/memory.js' add --catalog 'rules' --description 'Rules' --content 'Stable fact'";

  assert.deepEqual(classifyToolCallRisk(createCall(command)), {risk: 'safe'});
  const planResult = classifyToolCallRisk(createCall(command), 'plan');
  assert.equal(planResult.risk, 'rejected');
  assert.equal(planResult.reason, 'plan_mode');
});

test('tool risk classifier allows only readonly bash inspection commands in plan mode', () => {
  const allowedCommands = [
    'pwd',
    'ls -la',
    'cat package.json',
    'head -20 src/app/main.ts',
    'tail -20 npm-debug.log',
    'wc -l src/app/main.ts',
    'grep -R "hello" src',
    'rg "hello" src',
    'find . -name "*.ts"',
    'echo done',
    'printf hello',
    'git status --short',
    'git diff --stat',
    'git diff -- file.txt',
    'git log --oneline -1',
    'git show --stat HEAD',
    'git rev-parse --show-toplevel',
    'git branch --show-current',
    'git branch -a',
    'git branch --sort=-committerdate',
    'git tag -l',
    'git tag --sort=version:refname',
    'git stash list',
    'git stash show -p',
    'git config --get user.name',
    'git config --global --list',
    'git config --file .gitconfig user.email',
    'git remote -v',
    'git remote show origin',
    'git remote get-url origin',
    'git grep "todo" src',
    'git blame src/app/main.ts',
    'git describe --tags',
    'git rev-list --count HEAD',
    'git for-each-ref refs/heads',
    'git ls-tree -r HEAD',
    'git ls-remote origin',
    'git fsck --no-dangling',
    'git count-objects -v',
    'git name-rev HEAD',
    'git shortlog -sn',
    'git ls-files',
    'git merge-base HEAD HEAD',
    'git status | cat',
    'git log --oneline | head -20',
    'git status && git diff',
    'ls && git status',
    'cat package.json | grep version',
    'echo "a;b"',
    "echo 'a;b'",
    'echo hello\\;world',
    'rg "\\\\d+" src',
    "git log --format='%h;%s' -3",
    'git status\ngit diff'
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
    'git branch feature',
    'git tag v1',
    'git stash push',
    'git config user.email x',
    'git remote add origin https://example.com/repo.git',
    'git diff --output patch.txt',
    'git diff --output=patch.txt',
    'git diff > patch.txt',
    'git status && rm file.txt',
    'git status && git fetch',
    'git ls-files -z | xargs -0 rm',
    'find . -exec touch {} \\;',
    'find . -delete',
    'find . -fprint out.txt',
    'find . -fprint0 out.txt',
    'find . -fprintf out.txt %p',
    'echo hi > file',
    'echo hi >> log.txt',
    'echo \\" ; rm victim; echo \\"',
    'rg --pre /bin/rm needle victim.txt',
    'rg --pre=/bin/rm needle victim.txt',
    'rg --hostname-bin=/bin/rm needle victim.txt',
    'printf -v PATH /tmp/evil && ls',
    'cat "$(ls)"',
    'git diff "$(git rev-parse HEAD)"',
    'git status "$(rm x)"',
    'git grep --open-files-in-pager=/bin/rm needle',
    'git grep -O/bin/rm needle',
    'git ls-remote --upload-pack=/bin/rm victim',
    'git fsck --lost-found',
    'git status; rm file.txt',
    'git status & sleep 1',
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
