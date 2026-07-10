class LlmAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmAgentError';
  }
}

type ErrorWithMessage = {
  message: string;
};

function redactSensitiveText(text: string): string {
  return text
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;}]+/gi, '$1$2<redacted>')
    .replace(/(api[-_]?key\s*[:=]\s*)[^\s,;}]+/gi, '$1<redacted>')
    .replace(/(["']?(?:access|refresh|id)_token["']?\s*[:=]\s*["']?)[^"',\s;}]+(["']?)/gi, '$1<redacted>$2')
    .replace(/(token\s*[:=]\s*)[^\s,;}]+/gi, '$1<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/sk-[A-Za-z0-9_-]+/g, '<redacted>');
}

function normalizeError(error: unknown, fallbackMessage: string): LlmAgentError {
  if (error instanceof LlmAgentError) {
    return error;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as ErrorWithMessage).message === 'string' &&
    (error as ErrorWithMessage).message.trim() !== ''
  ) {
    return new LlmAgentError(`${fallbackMessage}：${redactSensitiveText((error as ErrorWithMessage).message)}`);
  }

  return new LlmAgentError(fallbackMessage);
}

export {
  LlmAgentError,
  normalizeError,
  redactSensitiveText
};
