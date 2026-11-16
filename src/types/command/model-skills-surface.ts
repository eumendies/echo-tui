import type {ReasoningEffort} from '../agent';
import type {SkillSourceKind} from '../skill';

export type SkillsCommandActiveField = 'effort' | 'model';

export type SkillsCommandSurface = {
  activeField: SkillsCommandActiveField;
  kind: 'skills';
  title: string;
  skills: CommandSkillSurfaceInfo[];
  selectedIndex: number;
  emptyLines: string[];
  dismissHint: string;
};

export type CommandSkillInfo = {
  name: string;
  description: string;
  sourceKind: SkillSourceKind;
  sourcePath: string;
  enabled: boolean;
  modelProfileId?: string;
  reasoningEffortOverride?: ReasoningEffort;
};

export type CommandSkillSurfaceInfo = CommandSkillInfo & {
  modelLabel: string;
};

export type CommandModelProfile = {
  id: string;
  model: string;
  provider: string;
  reasoningEffort?: ReasoningEffort;
};

export type CommandModelInfo = {
  models: CommandModelProfile[];
  selectedIndex: number;
};

export type CommandModelInfoResult = CommandModelInfo | {
  error: string;
};

export type CommandEffortInfo = {
  currentModelLabel: string;
  efforts: ReasoningEffort[];
  selectedIndex: number;
};

export type CommandEffortInfoResult = CommandEffortInfo | {
  error: string;
};
