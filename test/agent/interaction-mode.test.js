const test = require('node:test');
const assert = require('node:assert/strict');
const {createModeTransitionUserMessage} = require('../../src/agent/context/interaction-mode');

const modes = ['normal', 'plan', 'shell', 'shell-local'];

for (const from of modes) {
  for (const to of modes) {
    test(`mode transition accepts raw ${from} → ${to} and normalizes model semantics`, () => {
      const userText = '用户原文\ninspect @notes.txt';
      const transition = createModeTransitionUserMessage(userText, from, to);
      if ((from === 'plan') === (to === 'plan')) {
        assert.equal(transition, null);
        return;
      }
      assert.deepEqual(transition.metadata, {
        from: from === 'plan' ? 'plan' : 'normal',
        to: to === 'plan' ? 'plan' : 'normal'
      });
      assert.ok(transition.text.endsWith(`[User Request]\n${userText}`));
      assert.match(transition.text, to === 'plan'
        ? /Plan mode is active\. Discuss and inspect only/
        : /Normal mode is active\. Previous Plan Mode restrictions no longer apply/);
      assert.doesNotMatch(transition.text, /(?:from|to): shell/);
    });
  }
}
