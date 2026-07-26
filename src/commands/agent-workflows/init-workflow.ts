import type {AgentWorkflowDefinition} from '../../types/agent-workflow';

import {readAppSettings} from '../../config/app-settings-config';

import type {AgentInstructionFileName} from '../../types/agent';

function buildInitWorkflowPrompt(fileName: AgentInstructionFileName): string {
  return `Run the Echo TUI built-in /init workflow: analyze the current project and generate or review the ${fileName} at the project root.

Follow these steps in order:

1. Determine the project root
- Starting from the current working directory, prefer the nearest .git file/directory or a project-level .echo directory as the project-root marker.
- Do not mistake the ~/.echo directory used for global configuration in the user's home directory for the project root.
- Before taking any write action, make the target ${fileName} path explicit.

2. Gather repository evidence
- Prefer glob, grep, and read_files to inspect the repository; when necessary, use run_bash_command for read-only checks.
- You may inspect .git/HEAD, the .git file, or .echo paths in candidate directories, and combine them with repository config files to determine the project root.
- At minimum, inspect the applicable package/build configuration, source directories, test directories, README or development docs, CI configuration, and existing conventions.
- Identify the build, test, type-check, and start commands that actually work, plus the module organization and coding conventions you can verify from the source.
- Only adopt facts that can be verified in the repository; do not guess at commands, tools, conventions, or workflows that do not exist.

3. Check the project-root ${fileName}

If the file does not exist:
- Generate a concise, maintainable project-level ${fileName} covering project structure, common commands, coding conventions, testing requirements, and architectural constraints that are genuinely supported by evidence.
- Use apply_patch to create the file. Do not use shell redirection or any other file-writing method.
- After creating it successfully, summarize the key content and state clearly that the new ${fileName} will be loaded starting from the next agent request and will not retroactively affect the request that just initialized it.

If the file already exists:
- Read the existing ${fileName} and check it item by item against the current state of the repository.
- Do not call apply_patch to modify, overwrite, or rewrite the file.
- Output what the current file already covers well.
- Output prioritized improvement suggestions, pointing out content that is missing, outdated, ambiguous, or not verifiable from the repository.
- For each suggestion, provide the corresponding repository evidence and ready-to-use Markdown text or a localized diff.
- If there are no significant issues, state clearly that no priority changes were found; do not fabricate conventions just to produce suggestions.

Keep the analysis focused on ${fileName} and do not modify other project files.`;
}

const INIT_WORKFLOW_PROMPT = buildInitWorkflowPrompt('AGENTS.md');

function createInitWorkflowPrompt({argumentsText, fileName}: {argumentsText?: string; fileName?: AgentInstructionFileName} = {}): string {
  const prompt = buildInitWorkflowPrompt(fileName || readAppSettings().agentInstructionFileName);

  if (!argumentsText) {
    return prompt;
  }

  return `${prompt}

User-provided /init arguments:
${argumentsText}`;
}

const INIT_WORKFLOW: AgentWorkflowDefinition = {
  name: 'init',
  description: '分析项目并生成或评审当前指令文件',
  argumentPolicy: 'optional',
  modePolicy: 'switch_plan_to_normal',
  createPrompt: createInitWorkflowPrompt
};

export {
  INIT_WORKFLOW,
  INIT_WORKFLOW_PROMPT,
  createInitWorkflowPrompt
};
