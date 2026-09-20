import {INPUT_EVENTS} from '../input/event-types';
import {parseMcpPromptCommandText} from '../mcp/prompt-command-name';
import {capUtf8Text} from '../tools/tool-handler-utils';

import type {ChoiceCommandSurface, CommandHandler, CommandHost, CommandMcpPromptInfo, CommandSession, CommandStartResult} from '../types/command';
import type {InputEvent} from '../types/input';
import type {McpPromptArgument, McpPromptContentBlock, McpPromptMessage} from '../types/mcp';

const MAX_MCP_PROMPT_MESSAGE_BYTES = 20_000;
const TRUNCATION_MARKER = '[MCP prompt truncated]';

type PendingArgument = {
  argument: McpPromptArgument; // 当前待收集的参数声明。
  input: string; // 用户已经输入的原始文本。
};

type McpPromptCommandData = {
  prompt: CommandMcpPromptInfo; // 命中的 prompt 目录项。
  displayText: string; // 用户实际提交的命令文本。
  argumentsText?: string; // 命令行里给出的原始参数字符串，写入 metadata 供溯源。
  answers: Record<string, string>; // 已经确定的参数值。
  pending: PendingArgument[]; // 尚待收集的必填参数队列；为空表示收集完成。
};

type ParsedPromptArguments =
  | {ok: true; values: Record<string, string>}
  | {ok: false; message: string};

/**
 * MCP prompt 命令 handler：`/<server>:<prompt>` 命中目录后解析参数、按需收集缺失必填项，
 * 再把 prompts/get 的 messages 拼成单条用户消息交给既有的命令提交路径。
 */
export class McpPromptCommandHandler implements CommandHandler<McpPromptCommandData> {
  private readonly listPrompts: () => CommandMcpPromptInfo[];

  constructor(listPrompts: () => CommandMcpPromptInfo[]) {
    this.listPrompts = listPrompts;
  }

  match(text: string): boolean {
    const parsed = parseMcpPromptCommandText(text);
    return parsed !== null && this.findPrompt(parsed.commandName) !== null;
  }

  start(text: string, host: CommandHost): void | CommandStartResult {
    const parsed = parseMcpPromptCommandText(text);

    if (!parsed) {
      return;
    }

    const prompt = this.findPrompt(parsed.commandName);

    if (!prompt) {
      this.openPromptInfo(host, {
        title: `/${parsed.commandName}`,
        lines: [
          '当前目录中没有这个 MCP prompt。',
          ...createAvailablePromptLines(this.listPrompts())
        ]
      });
      return {kind: 'handled'};
    }

    const parsedArguments = parsePromptArguments(prompt, parsed.argumentsText);

    if (!parsedArguments.ok) {
      this.openPromptInfo(host, {
        title: `/${parsed.commandName}`,
        lines: [parsedArguments.message, '', createUsageLine(prompt)]
      });
      return {kind: 'handled'};
    }

    const missing = prompt.arguments.filter((argument) => argument.required && parsedArguments.values[argument.name] === undefined);

    // 参数已齐全：先展示取回中的 surface，异步完成后提交；缺失必填项则进入收集流程。
    if (missing.length === 0) {
      host.session.open({
        commandName: 'mcp-prompt',
        handler: this,
        surface: {
          kind: 'info',
          title: `/${prompt.commandName}`,
          lines: ['正在取回 MCP prompt…'],
          dismissHint: 'Esc 取消'
        },
        data: null
      });
      void this.fetchAndSubmit(host, prompt, text, parsed.argumentsText, parsedArguments.values);
      return {kind: 'handled'};
    }

    const data: McpPromptCommandData = {
      prompt,
      displayText: text,
      ...(parsed.argumentsText ? {argumentsText: parsed.argumentsText} : {}),
      answers: parsedArguments.values,
      pending: missing.map((argument) => ({argument, input: ''}))
    };

    host.session.open({
      commandName: 'mcp-prompt',
      handler: this,
      surface: createCollectionSurface(data),
      data
    });
    return {kind: 'handled'};
  }

  handleEvent(session: CommandSession<McpPromptCommandData>, event: InputEvent, host: CommandHost): void | Promise<void> {
    const data = session.data;

    if (event.type === INPUT_EVENTS.ESCAPE || !data) {
      host.session.close();
      return;
    }

    const current = data.pending[0];

    if (!current) {
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT) {
      current.input += event.value;
      host.session.update({surface: createCollectionSurface(data), data});
      return;
    }

    if (event.type === INPUT_EVENTS.BACKSPACE) {
      current.input = Array.from(current.input).slice(0, -1).join('');
      host.session.update({surface: createCollectionSurface(data), data});
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    // 必填参数不接受空值；其余事件保持当前收集状态。
    const value = current.input.trim();

    if (value === '') {
      return;
    }

    data.answers[current.argument.name] = value;
    data.pending.shift();

    if (data.pending.length > 0) {
      host.session.update({surface: createCollectionSurface(data), data});
      return;
    }

    const {prompt, displayText, argumentsText, answers} = data;
    // 保留会话并切换到取回状态:迟到守卫靠活跃会话识别自己,成功后由 fetchAndSubmit 关闭。
    host.session.update({
      surface: {
        kind: 'info',
        title: `/${prompt.commandName}`,
        lines: ['正在取回 MCP prompt…'],
        dismissHint: 'Esc 取消'
      },
      data: null
    });
    // 收集完成后的取回与提交复用带 argumentsText 的解析结果。
    return this.fetchAndSubmit(host, prompt, displayText, argumentsText, answers);
  }

  private findPrompt(commandName: string): CommandMcpPromptInfo | null {
    return this.listPrompts().find((prompt) => prompt.commandName === commandName) || null;
  }

  /** 用法与未命中提示共用的 info surface；Esc 关闭会话。 */
  private openPromptInfo(host: CommandHost, input: {title: string; lines: string[]}): void {
    host.session.open({
      commandName: 'mcp-prompt',
      handler: this,
      surface: {
        kind: 'info',
        title: input.title,
        lines: input.lines,
        dismissHint: 'Esc 关闭'
      },
      data: null
    });
  }

  /**
   * 取回 messages 并注入；handler 是单例，迟到回调必须按“会话引用是否仍是自己发起的那个”收敛，
   * 否则 Esc 之后启动的另一个 prompt 命令会被上一次取回的结果顶替。
   */
  private async fetchAndSubmit(host: CommandHost, prompt: CommandMcpPromptInfo, displayText: string, argumentsText: string | undefined, values: Record<string, string>): Promise<void> {
    // update/open 会替换会话对象、close 会置空，引用比较即“本次取回仍是当前会话”。
    const session = host.session.getActive();

    if (!session) {
      return;
    }

    const result = await host.mcp.getPromptMessages(prompt.serverName, prompt.promptName, values);

    if (host.session.getActive() !== session) {
      return;
    }

    if (!result.ok) {
      host.session.update({
        surface: {
          kind: 'info',
          title: `/${prompt.commandName}`,
          lines: [result.message, '', ...createAvailablePromptLines(this.listPrompts())],
          dismissHint: 'Esc 关闭'
        },
        data: null
      });
      return;
    }

    const text = formatPromptMessages(prompt, result.messages);
    host.session.close();
    await host.assistant.submitUserMessage({
      text,
      displayText,
      metadata: {
        mcpPrompt: {
          server: prompt.serverName,
          name: prompt.promptName,
          ...(argumentsText ? {argumentsText} : {})
        }
      }
    });
  }
}

function createAvailablePromptLines(prompts: CommandMcpPromptInfo[]): string[] {
  if (prompts.length === 0) {
    return ['当前没有可用的 MCP prompt（未配置 MCP、已禁用，或 server 未声明 prompts capability）。'];
  }

  return ['可用 prompt：', ...prompts.map((prompt) => `- /${prompt.commandName}`)];
}

function createUsageLine(prompt: CommandMcpPromptInfo): string {
  if (prompt.arguments.length === 0) {
    return `用法：/${prompt.commandName}`;
  }

  const usage = prompt.arguments
    .map((argument) => argument.required ? `<${argument.name}>` : `[${argument.name}]`)
    .join(' ');

  return `用法：/${prompt.commandName} ${usage}（也支持 ${prompt.arguments[0].name}=value）`;
}

function createCollectionSurface(data: McpPromptCommandData): ChoiceCommandSurface {
  const current = data.pending[0];
  const remaining = data.pending.length;
  const requirement = current.argument.required ? '（必填）' : '';

  return {
    kind: 'choice',
    title: `/${data.prompt.commandName}`,
    message: current.argument.description || current.argument.name,
    messageTitle: `参数 ${current.argument.name}${requirement}`,
    optionsTitle: remaining > 1 ? `待填写参数（剩 ${remaining} 个）` : '待填写参数',
    options: [{
      label: current.argument.name,
      selected: true,
      inlineInput: {
        cursor: Array.from(current.input).length,
        placeholder: '输入参数值后回车',
        text: current.input
      }
    }],
    focusedIndex: 0,
    dismissHint: 'Enter 确认 · Backspace 删除 · Esc 取消'
  };
}

/**
 * 拼接 messages：按序保留全部内容并标注 role，非文本块转占位符，超限截断后追加 marker。
 */
function formatPromptMessages(prompt: CommandMcpPromptInfo, messages: McpPromptMessage[]): string {
  const header = `[MCP prompt: ${prompt.commandName}]`;
  const body = messages
    .map((message) => `[${message.role}]\n${formatPromptContent(prompt, message.content)}`)
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  const text = body === '' ? `${header}\n\n(prompt returned no messages)` : `${header}\n\n${body}`;
  // 截断 marker 也计入最终预算,保证注入的 user message 不超过上限。
  const marker = `\n\n${TRUNCATION_MARKER}`;
  const capped = capUtf8Text(text, MAX_MCP_PROMPT_MESSAGE_BYTES - Buffer.byteLength(marker, 'utf8'));

  return capped.truncated ? `${capped.text}${marker}` : capped.text;
}

function formatPromptContent(prompt: CommandMcpPromptInfo, content: McpPromptContentBlock): string {
  switch (content.kind) {
    case 'text':
      return content.text;
    case 'image':
      return `[image: ${content.mimeType}, ${content.sizeBytes} bytes]`;
    case 'audio':
      return `[audio: ${content.mimeType}, ${content.sizeBytes} bytes]`;
    case 'resource': {
      const label = `[embedded resource: ${content.uri}${content.mimeType ? ` (${content.mimeType})` : ''}]`;
      return content.text !== undefined
        ? `${label}\n${content.text}`
        : `${label}\nRead it with read_mcp_resource (server: ${prompt.serverName}, uri: ${content.uri}).`;
    }
    case 'resource_link':
      return `[resource_link: ${content.uri}${content.name ? ` (${content.name})` : ''}]`;
  }
}

/** 解析位置参数与 key=value；引号内的空白保留，未知参数名按用法错误处理。 */
function parsePromptArguments(prompt: CommandMcpPromptInfo, argumentsText: string | undefined): ParsedPromptArguments {
  const values: Record<string, string> = {};
  const declared = new Map(prompt.arguments.map((argument) => [argument.name, argument]));
  let positionalIndex = 0;

  for (const token of tokenizeArguments(argumentsText)) {
    const assignment = /^([A-Za-z0-9_.-]+)=([\s\S]*)$/u.exec(token);

    if (assignment) {
      if (!declared.has(assignment[1])) {
        return {ok: false, message: `未知参数：${assignment[1]}`};
      }

      values[assignment[1]] = assignment[2];
      continue;
    }

    while (positionalIndex < prompt.arguments.length && values[prompt.arguments[positionalIndex].name] !== undefined) {
      positionalIndex += 1;
    }

    if (positionalIndex >= prompt.arguments.length) {
      return {ok: false, message: `参数过多：${token}`};
    }

    values[prompt.arguments[positionalIndex].name] = token;
    positionalIndex += 1;
  }

  return {ok: true, values};
}

function tokenizeArguments(text: string | undefined): string[] {
  if (!text) {
    return [];
  }

  const tokens: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && /\s/u.test(char)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }

      continue;
    }

    current += char;
  }

  if (current !== '') {
    tokens.push(current);
  }

  return tokens;
}

export {
  MAX_MCP_PROMPT_MESSAGE_BYTES,
  TRUNCATION_MARKER,
  formatPromptMessages,
  parsePromptArguments,
  tokenizeArguments
};
