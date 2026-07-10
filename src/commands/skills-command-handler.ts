import {INPUT_EVENTS} from '../input/event-types';

import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  CommandSkillInfo,
  SkillsCommandSurface
} from '../types/command';
import type {InputEvent} from '../types/input';

type SkillsManageData = {
  selectedIndex: number;
  skills: CommandSkillInfo[];
};

function createSkillsSurface(data: SkillsManageData): SkillsCommandSurface {
  return {
    kind: 'skills',
    title: 'SKILLS',
    skills: data.skills,
    selectedIndex: data.selectedIndex,
    emptyLines: [
      '当前没有发现可用 skill。',
      '项目级目录：.echo/skills/<name>/SKILL.md',
      '用户级目录：~/.echo/skills/<name>/SKILL.md'
    ],
    dismissHint: 'Space 切换 · Enter 保存 · Esc 取消'
  };
}

function normalizeSkillsManageData(source: SkillsManageData): SkillsManageData {
  const maxIndex = Math.max(0, source.skills.length - 1);
  const selectedIndex = Math.min(Math.max(0, source.selectedIndex), maxIndex);

  return {
    selectedIndex,
    skills: source.skills.map((skill) => ({...skill}))
  };
}

export class SkillsCommandHandler implements CommandHandler<SkillsManageData> {
  name = 'skills';
  description = '查看和管理 skills';

  match(text: string): boolean {
    return String(text).trim() === '/skills';
  }

  start(_text: string, host: CommandHost): void {
    const data = normalizeSkillsManageData({selectedIndex: 0, skills: host.skills.listSkills()});
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

    if (event.type === INPUT_EVENTS.TEXT && event.value === ' ') {
      const nextData = normalizeSkillsManageData({
        ...data,
        skills: data.skills.map((skill, index) => index === data.selectedIndex ? {...skill, enabled: !skill.enabled} : skill)
      });
      host.session.update({surface: createSkillsSurface(nextData), data: nextData});
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      host.skills.saveSkillStates(data.skills);
      host.session.close();
      host.composer.reset();
    }
  }
}

export {createSkillsSurface};
