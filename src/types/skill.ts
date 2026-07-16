export type SkillSourceKind = 'project' | 'user';

export type SkillCatalogEntry = {
  name: string;
  description: string;
  sourceKind: SkillSourceKind;
  sourcePath: string;
};

export type SkillDefinition = SkillCatalogEntry & {
  content: string;
  resources: string[];
};

export type SkillListItem = SkillCatalogEntry & {
  enabled: boolean;
  modelProfileId?: string;
};

export type SkillLoadResult =
  | {ok: true; skill: SkillDefinition; modelProfileId?: string}
  | {ok: false; reason: 'disabled' | 'invalid' | 'missing'; message: string; availableSkills: SkillCatalogEntry[]};

export type SkillUseRecord = {
  argumentsText?: string;
  createdAt?: string;
  skillName: string;
} & (
  | {source: 'tool'; toolCallId: string}
  | {source: 'slash'}
);

export type SkillRegistry = {
  listCatalog: () => SkillCatalogEntry[];
  loadSkill: (name: string) => SkillLoadResult;
};

export type SkillManager = SkillRegistry & {
  listSkills: () => SkillListItem[];
  saveSkillStates: (skills: SkillListItem[]) => void;
};
