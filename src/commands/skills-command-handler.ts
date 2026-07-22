import {INPUT_EVENTS} from '../input/event-types';

import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  CommandSkillInfo,
  CommandSkillSurfaceInfo,
  CommandModelProfile,
  SkillsCommandActiveField,
  SkillsCommandSurface
} from '../types/command';
import type {InputEvent} from '../types/input';
import type {ReasoningEffort} from '../types/agent';

import {REASONING_EFFORTS} from '../types/agent';

type SkillsManageData = {
  activeField: SkillsCommandActiveField;
  modelOptions: SkillModelOption[];
  selectedIndex: number;
  skills: CommandSkillSurfaceInfo[];
};

type SkillModelOption = {
  label: string;
  modelProfileId?: string;
};

const CURRENT_MODEL_LABEL = '当前模型';
const EFFORT_OPTIONS: readonly (ReasoningEffort | undefined)[] = [undefined, ...REASONING_EFFORTS];

function createSkillsSurface(data: SkillsManageData): SkillsCommandSurface {
  return {
    kind: 'skills',
    activeField: data.activeField,
    title: 'SKILLS',
    skills: data.skills,
    selectedIndex: data.selectedIndex,
    emptyLines: [
      '当前没有发现可用 skill。',
      '项目级目录：.echo/skills/<name>/SKILL.md',
      '用户级目录：~/.echo/skills/<name>/SKILL.md'
    ],
    dismissHint: `当前字段 ${data.activeField === 'model' ? '模型' : 'effort'} · Tab 切换 · ←/→ 调整 (仅限slash调用) · Space 启停 · Enter 保存 · Esc 取消`
  };
}

function normalizeSkillsManageData(source: SkillsManageData): SkillsManageData {
  const maxIndex = Math.max(0, source.skills.length - 1);
  const selectedIndex = Math.min(Math.max(0, source.selectedIndex), maxIndex);

  return {
    activeField: source.activeField,
    modelOptions: source.modelOptions.map((option) => ({...option})),
    selectedIndex,
    skills: source.skills.map((skill) => ({...skill}))
  };
}

function createModelOptions(host: CommandHost): SkillModelOption[] {
  const modelInfo = host.model.createModelCommandInfo();

  if (!('models' in modelInfo)) {
    return [{label: CURRENT_MODEL_LABEL}];
  }

  return [
    {label: CURRENT_MODEL_LABEL},
    ...modelInfo.models.map((profile) => ({
      label: createModelLabel(profile),
      modelProfileId: profile.id
    }))
  ];
}

function createModelLabel(profile: CommandModelProfile): string {
  return profile.id;
}

function createSkillsManageData(skills: CommandSkillInfo[], modelOptions: SkillModelOption[]): SkillsManageData {
  const validProfileIds = new Set(modelOptions.flatMap((option) => option.modelProfileId ? [option.modelProfileId] : []));

  return normalizeSkillsManageData({
    activeField: 'model',
    modelOptions,
    selectedIndex: 0,
    skills: skills.map((skill) => {
      const modelProfileId = skill.modelProfileId && validProfileIds.has(skill.modelProfileId)
        ? skill.modelProfileId
        : undefined;
      const modelLabel = modelOptions.find((option) => option.modelProfileId === modelProfileId)?.label || CURRENT_MODEL_LABEL;

      return {...skill, modelProfileId, modelLabel};
    })
  });
}

function cycleSelectedSkillEffort(data: SkillsManageData, direction: number): SkillsManageData {
  const selectedSkill = data.skills[data.selectedIndex];

  if (!selectedSkill) {
    return data;
  }

  const currentIndex = Math.max(0, EFFORT_OPTIONS.indexOf(selectedSkill.reasoningEffortOverride));
  const nextIndex = (currentIndex + direction + EFFORT_OPTIONS.length) % EFFORT_OPTIONS.length;
  const nextEffort = EFFORT_OPTIONS[nextIndex];

  return normalizeSkillsManageData({
    ...data,
    skills: data.skills.map((skill, index) => index === data.selectedIndex
      ? {...skill, reasoningEffortOverride: nextEffort}
      : skill)
  });
}

function cycleSelectedSkillModel(data: SkillsManageData, direction: number): SkillsManageData {
  const selectedSkill = data.skills[data.selectedIndex];

  if (!selectedSkill || data.modelOptions.length <= 1) {
    return data;
  }

  const currentIndex = Math.max(0, data.modelOptions.findIndex((option) => option.modelProfileId === selectedSkill.modelProfileId));
  const nextIndex = (currentIndex + direction + data.modelOptions.length) % data.modelOptions.length;
  const nextOption = data.modelOptions[nextIndex];

  return normalizeSkillsManageData({
    ...data,
    skills: data.skills.map((skill, index) => index === data.selectedIndex
      ? {...skill, modelProfileId: nextOption.modelProfileId, modelLabel: nextOption.label}
      : skill)
  });
}

export class SkillsCommandHandler implements CommandHandler<SkillsManageData> {
  name = 'skills';
  description = '查看和管理 skills';

  match(text: string): boolean {
    return text.trim() === '/skills';
  }

  start(_text: string, host: CommandHost): void {
    const data = createSkillsManageData(host.skills.listSkills(), createModelOptions(host));
    host.composer.reset();
    host.session.open({
      commandName: 'skills',
      handler: this,
      surface: createSkillsSurface(data),
      data
    });
  }

  handleEvent(session: CommandSession<SkillsManageData>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      host.composer.reset();
      return;
    }

    const data = session.data;

    if (!data || data.skills.length === 0) {
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const direction = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      const nextData = normalizeSkillsManageData({...data, selectedIndex: data.selectedIndex + direction});
      host.session.update({surface: createSkillsSurface(nextData), data: nextData});
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_LEFT || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      const direction = event.type === INPUT_EVENTS.MOVE_LEFT ? -1 : 1;
      const nextData = data.activeField === 'model'
        ? cycleSelectedSkillModel(data, direction)
        : cycleSelectedSkillEffort(data, direction);

      if (nextData !== data) {
        host.session.update({surface: createSkillsSurface(nextData), data: nextData});
      }
      return;
    }

    if (event.type === INPUT_EVENTS.TAB || event.type === INPUT_EVENTS.SHIFT_TAB) {
      const nextData = normalizeSkillsManageData({
        ...data,
        activeField: data.activeField === 'model' ? 'effort' : 'model'
      });
      host.session.update({surface: createSkillsSurface(nextData), data: nextData});
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      const nextData = normalizeSkillsManageData({
        ...data,
        skills: data.skills.map((skill, index) => index === data.selectedIndex ? {...skill, enabled: !skill.enabled} : skill)
      });
      host.session.update({surface: createSkillsSurface(nextData), data: nextData});
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      host.skills.saveSkillStates(data.skills.map(({modelLabel: _modelLabel, ...skill}) => skill));
      host.session.close();
      host.composer.reset();
    }
  }
}

export {createSkillsSurface};
