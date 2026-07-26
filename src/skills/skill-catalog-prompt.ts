import {estimateTextTokens} from '../agent/context/token-estimator';

import type {SkillCatalogEntry} from '../types/skill';

const DEFAULT_SKILL_CATALOG_CONTEXT_RATIO = 0.02;
const SKILL_DESCRIPTION_HEAD_RATIO = 0.7;
const SKILL_DESCRIPTION_OMISSION_MARKER = ' […description truncated…] ';

type SkillCatalogPromptProjection = {
  budgetTokens: number;
  catalog: SkillCatalogEntry[];
  estimatedTokens: number;
  mode: 'full' | 'truncated' | 'names_only';
  originalTokens: number;
};

/**
 * 把 skill catalog 渲染为短 system prompt 片段；这里只放路由元数据，不放 SKILL.md 正文。
 */
function formatSkillCatalogPrompt(catalog: SkillCatalogEntry[] = []): string {
  if (catalog.length === 0) {
    return '';
  }

  const lines = catalog.map((skill) => skill.description === '' ? `- ${skill.name}` : `- ${skill.name}: ${skill.description}`);

  return `Available Skills:
When the user's request clearly matches the description of a skill, call the \`use_skill\` tool to load that skill's full instructions; do not load all skills unconditionally.
${lines.join('\n')}`;
}

/**
 * 按模型窗口预算生成 provider-facing catalog；原始 registry metadata 始终保持完整。
 */
function createSkillCatalogPromptProjection(catalog: SkillCatalogEntry[] = [], contextWindow: number, contextRatio = DEFAULT_SKILL_CATALOG_CONTEXT_RATIO): SkillCatalogPromptProjection {
  const sourceCatalog = catalog.map((skill) => ({...skill}));
  const originalText = formatSkillCatalogPrompt(sourceCatalog);
  const originalTokens = estimateTextTokens(originalText);
  const budgetTokens = calculateSkillCatalogBudget(contextWindow, contextRatio);

  if (sourceCatalog.length === 0 || originalTokens <= budgetTokens) {
    return {budgetTokens, catalog: sourceCatalog, estimatedTokens: originalTokens, mode: 'full', originalTokens};
  }

  const namesOnlyCatalog = sourceCatalog.map((skill) => ({...skill, description: ''}));
  const namesOnlyTokens = estimateTextTokens(formatSkillCatalogPrompt(namesOnlyCatalog));

  if (namesOnlyTokens > budgetTokens) {
    return {budgetTokens, catalog: namesOnlyCatalog, estimatedTokens: namesOnlyTokens, mode: 'names_only', originalTokens};
  }

  const maxDescriptionTokens = sourceCatalog.reduce((max, skill) => Math.max(max, estimateTextTokens(skill.description)), 0);
  // 所有描述共享同一个 token cap：短描述保持完整，长描述限制到相同上限，避免列表顺序决定谁被保留。
  // cap 越大，投影后的总 token 单调不减，因此可以二分寻找“不超过总预算”的最大值，尽量用满可用空间。
  let lower = 0;
  let upper = maxDescriptionTokens;
  let selectedCatalog = namesOnlyCatalog;
  let selectedTokens = namesOnlyTokens;
  let selectedCap = 0;

  while (lower <= upper) {
    const cap = Math.floor((lower + upper) / 2);
    const candidateCatalog = projectDescriptions(sourceCatalog, cap);
    const candidateTokens = estimateTextTokens(formatSkillCatalogPrompt(candidateCatalog));

    if (candidateTokens <= budgetTokens) {
      // 当前 cap 可行，保留这份结果并继续向右搜索；后续失败时仍可回退到最后一个可行解。
      selectedCatalog = candidateCatalog;
      selectedTokens = candidateTokens;
      selectedCap = cap;
      lower = cap + 1;
    } else {
      // 当前 cap 已使完整 prompt 超出预算，更大的 cap 也不会可行，直接舍弃右半区间。
      upper = cap - 1;
    }
  }

  return {
    budgetTokens,
    catalog: selectedCatalog,
    estimatedTokens: selectedTokens,
    mode: selectedCap === 0 ? 'names_only' : 'truncated',
    originalTokens
  };
}

function calculateSkillCatalogBudget(contextWindow: number, contextRatio: number): number {
  const normalizedWindow = Number.isFinite(contextWindow) ? Math.max(0, Math.floor(contextWindow)) : 0;
  const normalizedRatio = Number.isFinite(contextRatio) && contextRatio >= 0 ? contextRatio : DEFAULT_SKILL_CATALOG_CONTEXT_RATIO;
  return Math.floor(normalizedWindow * normalizedRatio);
}

function projectDescriptions(catalog: SkillCatalogEntry[], capTokens: number): SkillCatalogEntry[] {
  return catalog.map((skill) => ({
    ...skill,
    description: truncateSkillDescription(skill.description, capTokens)
  }));
}

/**
 * 在估算 token 上限内保留 description 首尾，避免丢失末尾常见的排除和转交规则。
 */
function truncateSkillDescription(description: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return '';
  }

  if (estimateTextTokens(description) <= maxTokens) {
    return description;
  }

  if (estimateTextTokens(SKILL_DESCRIPTION_OMISSION_MARKER) > maxTokens) {
    return '';
  }

  const characters = Array.from(description);
  // 同一个 description 内也利用 token 单调性二分最大保留字符数；候选文本始终按 70% 头部、30% 尾部分配。
  let lower = 0;
  let upper = Math.max(0, characters.length - 1);
  let selected = SKILL_DESCRIPTION_OMISSION_MARKER;

  while (lower <= upper) {
    const retainedCount = Math.floor((lower + upper) / 2);
    const candidate = createHeadTailDescription(characters, retainedCount);

    if (estimateTextTokens(candidate) <= maxTokens) {
      selected = candidate;
      lower = retainedCount + 1;
    } else {
      upper = retainedCount - 1;
    }
  }

  return selected;
}

function createHeadTailDescription(characters: string[], retainedCount: number): string {
  const headCount = Math.ceil(retainedCount * SKILL_DESCRIPTION_HEAD_RATIO);
  const tailCount = Math.max(0, retainedCount - headCount);
  const head = characters.slice(0, headCount).join('');
  const tail = tailCount > 0 ? characters.slice(-tailCount).join('') : '';
  return `${head}${SKILL_DESCRIPTION_OMISSION_MARKER}${tail}`;
}

export {
  DEFAULT_SKILL_CATALOG_CONTEXT_RATIO,
  createSkillCatalogPromptProjection,
  formatSkillCatalogPrompt,
  truncateSkillDescription
};

export type {SkillCatalogPromptProjection};
