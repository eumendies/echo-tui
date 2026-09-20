/**
 * prompt 命令命名：server 与 prompt 名里的空白和 `/` 归一为 `-`，再用 `:` 组成命令名。
 * 归一规则由 ports 与命令 handler 共用，避免两侧各写一份导致匹配漂移。
 */
function normalizePromptCommandPart(value: string): string {
  return value.replace(/[\s/]+/gu, '-');
}

function createMcpPromptCommandName(serverName: string, promptName: string): string {
  return `${normalizePromptCommandPart(serverName)}:${normalizePromptCommandPart(promptName)}`;
}

/**
 * 解析 `/server:prompt args`；命令名必须含 `:`，否则交还其它 handler。
 */
function parseMcpPromptCommandText(text: string): {commandName: string; argumentsText?: string} | null {
  const match = /^\/([^/\s:]+:[^/\s]+)(?:\s+([\s\S]*))?$/u.exec(text);

  if (!match) {
    return null;
  }

  const commandName = match[1];
  const argumentsText = match[2]?.trim();

  return {
    commandName,
    ...(argumentsText ? {argumentsText} : {})
  };
}

export {
  createMcpPromptCommandName,
  normalizePromptCommandPart,
  parseMcpPromptCommandText
};
