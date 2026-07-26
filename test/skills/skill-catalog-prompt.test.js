const assert = require('node:assert/strict');
const test = require('node:test');

const {estimateTextTokens} = require('../../src/agent/context/token-estimator');
const {
  createSkillCatalogPromptProjection,
  formatSkillCatalogPrompt,
  truncateSkillDescription
} = require('../../src/skills/skill-catalog-prompt');

function skill(name, description) {
  return {
    name,
    description,
    sourceKind: 'project',
    sourcePath: `/tmp/${name}/SKILL.md`
  };
}

test('skill catalog projection keeps the existing prompt when it fits the budget', () => {
  const catalog = [skill('review', 'Review code changes.'), skill('test', 'Run focused tests.')];
  const expectedText = formatSkillCatalogPrompt(catalog);
  const originalTokens = estimateTextTokens(expectedText);
  const projection = createSkillCatalogPromptProjection(catalog, originalTokens, 1);

  assert.equal(projection.mode, 'full');
  assert.equal(projection.originalTokens, originalTokens);
  assert.equal(projection.estimatedTokens, originalTokens);
  assert.equal(formatSkillCatalogPrompt(projection.catalog), expectedText);
  assert.deepEqual(catalog.map((entry) => entry.description), ['Review code changes.', 'Run focused tests.']);
});

test('skill catalog projection fairly truncates long descriptions within the total budget', () => {
  const shortDescription = 'Short routing hint.';
  const firstLong = `FIRST-BEGIN ${'alpha '.repeat(120)} FIRST-END`;
  const secondLong = `SECOND-BEGIN ${'beta '.repeat(120)} SECOND-END`;
  const catalog = [skill('first', firstLong), skill('second', secondLong), skill('short', shortDescription)];
  const namesOnlyTokens = estimateTextTokens(formatSkillCatalogPrompt(catalog.map((entry) => ({...entry, description: ''}))));
  const budgetTokens = namesOnlyTokens + estimateTextTokens(shortDescription) + 55;
  const projection = createSkillCatalogPromptProjection(catalog, budgetTokens, 1);
  const projectedByName = new Map(projection.catalog.map((entry) => [entry.name, entry.description]));

  assert.equal(projection.mode, 'truncated');
  assert.ok(projection.estimatedTokens <= projection.budgetTokens);
  assert.equal(projectedByName.get('short'), shortDescription);
  assert.match(projectedByName.get('first'), /^FIRST-BEGIN/);
  assert.match(projectedByName.get('first'), /FIRST-END$/);
  assert.match(projectedByName.get('first'), /\[…description truncated…\]/);
  assert.match(projectedByName.get('second'), /^SECOND-BEGIN/);
  assert.match(projectedByName.get('second'), /SECOND-END$/);
  assert.deepEqual(projection.catalog.map((entry) => entry.name), catalog.map((entry) => entry.name));
});

test('skill catalog projection falls back to all names when fixed overhead exceeds the budget', () => {
  const catalog = [skill('one', 'First description'), skill('two', 'Second description')];
  const projection = createSkillCatalogPromptProjection(catalog, 10, 0.01);
  const prompt = formatSkillCatalogPrompt(projection.catalog);

  assert.equal(projection.mode, 'names_only');
  assert.deepEqual(projection.catalog.map((entry) => entry.description), ['', '']);
  assert.match(prompt, /- one\n/);
  assert.match(prompt, /- two$/);
  assert.doesNotMatch(prompt, /First description|Second description/);
});

test('skill description truncation is unicode-safe, bounded and deterministic', () => {
  const description = `能力😀开始${'中间内容'.repeat(30)}末尾规则🧭`;
  const first = truncateSkillDescription(description, 18);
  const second = truncateSkillDescription(description, 18);

  assert.equal(first, second);
  assert.ok(estimateTextTokens(first) <= 18);
  assert.match(first, /^能力😀/);
  assert.match(first, /规则🧭$/);
  assert.match(first, /\[…description truncated…\]/);
  assert.doesNotMatch(first, /�/);
});

test('skill catalog projection returns deterministic output at the budget boundary', () => {
  const catalog = [skill('large', 'routing '.repeat(200)), skill('small', 'small')];
  const first = createSkillCatalogPromptProjection(catalog, 1000, 0.08);
  const second = createSkillCatalogPromptProjection(catalog, 1000, 0.08);

  assert.deepEqual(first, second);
  assert.ok(first.estimatedTokens <= first.budgetTokens || first.mode === 'names_only');
});
