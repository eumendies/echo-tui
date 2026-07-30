const {
  addAgentMemory,
  listAgentMemoryCatalogs,
  readAgentMemoryCatalog,
  readEffectiveAgentMemoryCatalog,
  removeAgentMemoryCatalog,
  removeAgentMemoryItem,
  updateAgentMemoryCatalog,
  updateAgentMemoryItem
} = require('../../../../memory/agent-memory-store');

const ACTION_FLAGS = {
  read: new Set(['catalog', 'scope']),
  add: new Set(['catalog', 'content', 'description', 'scope']),
  'update-item': new Set(['catalog', 'item-id', 'content', 'scope']),
  'update-catalog': new Set(['catalog', 'name', 'description', 'scope']),
  'remove-item': new Set(['catalog', 'item-id', 'scope']),
  'remove-catalog': new Set(['catalog', 'scope']),
  validate: new Set([])
};

function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const parsed = parseArguments(argv);
  if (!parsed.ok) return fail(parsed.error);

  const {action, values} = parsed;
  const scope = values.scope;
  let result;

  if (action === 'read') {
    result = readEffectiveAgentMemoryCatalog(cwd, values.catalog, scope);
    if (!result.ok) return fail(result.error);
    return succeed({
      catalog: {name: result.catalog.name, description: result.catalog.description, scope: result.catalog.scope.kind},
      memories: result.memories.map(({id, content}) => ({id, content}))
    });
  }

  if (action === 'add') {
    const targetScope = scope || 'project';
    const enabled = rejectDisabledCatalog(cwd, values.catalog, targetScope);
    if (!enabled.ok) return fail(enabled.error);
    result = addAgentMemory(cwd, {
      catalog: values.catalog,
      content: values.content,
      ...(values.description ? {description: values.description} : {}),
      scope: targetScope
    });
    if (!result.ok) return fail(result.error);
    const memory = result.memories?.at(-1);
    return succeed({catalog: projectCatalog(result.catalog), memory: memory ? {id: memory.id, content: memory.content} : undefined});
  }

  if (action === 'update-item') {
    const enabled = rejectDisabledCatalog(cwd, values.catalog, scope);
    if (!enabled.ok) return fail(enabled.error);
    result = updateAgentMemoryItem(cwd, values.catalog, values['item-id'], values.content, scope);
    if (!result.ok) return fail(result.error);
    const memory = result.memories?.find((item) => item.id === values['item-id']);
    return succeed({catalog: projectCatalog(result.catalog), memory: memory ? {id: memory.id, content: memory.content} : undefined});
  }

  if (action === 'update-catalog') {
    const enabled = rejectDisabledCatalog(cwd, values.catalog, scope);
    if (!enabled.ok) return fail(enabled.error);
    result = updateAgentMemoryCatalog(cwd, values.catalog, {
      ...(values.name ? {name: values.name} : {}),
      ...(values.description ? {description: values.description} : {})
    }, scope);
    return result.ok ? succeed({catalog: projectCatalog(result.catalog)}) : fail(result.error);
  }

  if (action === 'remove-item') {
    const enabled = rejectDisabledCatalog(cwd, values.catalog, scope);
    if (!enabled.ok) return fail(enabled.error);
    result = removeAgentMemoryItem(cwd, values.catalog, values['item-id'], scope);
    return result.ok ? succeed({removedItemId: values['item-id'], removedCatalog: result.removedCatalog === true}) : fail(result.error);
  }

  if (action === 'remove-catalog') {
    const enabled = rejectDisabledCatalog(cwd, values.catalog, scope);
    if (!enabled.ok) return fail(enabled.error);
    result = removeAgentMemoryCatalog(cwd, values.catalog, scope);
    return result.ok ? succeed({removedCatalog: values.catalog}) : fail(result.error);
  }

  result = validateAccessibleMemory(cwd);
  return result.ok ? succeed(result.value) : fail(result.error);
}

function parseArguments(argv) {
  const [action, ...args] = argv;
  const allowed = ACTION_FLAGS[action];
  if (!allowed) return {ok: false, error: `unknown action: ${action || '(missing)'}`};
  if (args.length % 2 !== 0) return {ok: false, error: 'every flag must have a value'};

  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag.startsWith('--')) return {ok: false, error: `invalid flag: ${flag}`};
    const name = flag.slice(2);
    if (!allowed.has(name)) return {ok: false, error: `unsupported flag for ${action}: --${name}`};
    if (Object.hasOwn(values, name)) return {ok: false, error: `duplicate flag: --${name}`};
    if (value.trim() === '') return {ok: false, error: `--${name} must be non-empty`};
    values[name] = value;
  }

  if (values.scope && values.scope !== 'global' && values.scope !== 'project') {
    return {ok: false, error: '--scope must be global or project'};
  }

  const missing = requiredFlags(action).find((name) => !values[name]);
  if (missing) return {ok: false, error: `--${missing} is required for ${action}`};
  if (action === 'update-catalog' && !values.name && !values.description) {
    return {ok: false, error: 'update-catalog requires --name or --description'};
  }
  return {ok: true, action, values};
}

function requiredFlags(action) {
  if (action === 'read') return ['catalog'];
  if (action === 'add') return ['catalog', 'content'];
  if (action === 'update-item') return ['catalog', 'item-id', 'content', 'scope'];
  if (action === 'update-catalog') return ['catalog', 'scope'];
  if (action === 'remove-item') return ['catalog', 'item-id', 'scope'];
  if (action === 'remove-catalog') return ['catalog', 'scope'];
  return [];
}

function rejectDisabledCatalog(cwd, catalogName, scope) {
  const listed = listAgentMemoryCatalogs(cwd);
  if (!listed.ok) return listed;
  const normalizedName = catalogName.trim().toLocaleLowerCase();
  const catalog = listed.catalogs.find((item) => item.scope.kind === scope && item.name.trim().toLocaleLowerCase() === normalizedName);
  return catalog && !catalog.enabled
    ? {ok: false, error: 'agent memory catalog 已停用；请由用户通过 /memory 管理'}
    : {ok: true};
}

function validateAccessibleMemory(cwd) {
  const listed = listAgentMemoryCatalogs(cwd);
  if (!listed.ok) return listed;
  let itemCount = 0;
  for (const catalog of listed.catalogs) {
    const read = readAgentMemoryCatalog(cwd, catalog.name, catalog.scope.kind);
    if (!read.ok) return read;
    itemCount += read.memories.length;
  }
  return {ok: true, value: {valid: true, catalogCount: listed.catalogs.length, itemCount}};
}

function projectCatalog(catalog) {
  return catalog ? {name: catalog.name, description: catalog.description, scope: catalog.scope.kind} : undefined;
}

function succeed(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  return 0;
}

function fail(error) {
  process.stderr.write(`${error}\n`);
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {main, parseArguments, validateAccessibleMemory};
