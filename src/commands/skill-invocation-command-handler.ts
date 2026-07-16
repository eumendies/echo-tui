import type {CommandHandler, CommandHost, CommandStartResult} from '../types/command';

function parseSkillSlashText(text: string): {argumentsText?: string; name: string} | null {
  const match = /^\/([^/\s]+)(?:\s+([\s\S]*))?$/u.exec(String(text));

  if (!match) {
    return null;
  }

  const name = match[1].trim();

  if (name === '') {
    return null;
  }

  const argumentsText = match[2]?.trim();
  return {name, argumentsText: argumentsText || undefined};
}

export class SkillInvocationCommandHandler implements CommandHandler {
  match(text: string): boolean {
    return Boolean(parseSkillSlashText(text));
  }

  start(text: string, host: CommandHost): void | CommandStartResult {
    const parsed = parseSkillSlashText(text);

    if (!parsed) {
      return;
    }

    const result = host.skills.createSkillInvocation(parsed.name, parsed.argumentsText);

    if (result.ok) {
      return {
        kind: 'submit_user_message',
        text: result.text,
        displayText: String(text),
        metadata: result.metadata,
        ...(result.modelProfileId ? {modelProfileId: result.modelProfileId} : {})
      };
    }

    if (result.reason === 'disabled') {
      host.composer.reset();
      host.session.open({
        commandName: 'skill-invocation',
        handler: this,
        surface: {
          kind: 'info',
          title: `/${parsed.name}`,
          lines: [
            `skill "${parsed.name}" 当前已禁用。`,
            '可通过 /skills 重新启用。'
          ],
          dismissHint: 'Esc 关闭'
        },
        data: null
      });
      return {kind: 'handled'};
    }

    return {kind: 'not_matched'};
  }
}

export {parseSkillSlashText};
