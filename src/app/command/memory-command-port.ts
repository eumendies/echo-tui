import {addAgentMemory, listAgentMemoryCatalogs, readAgentMemoryCatalog, removeAgentMemoryCatalog, removeAgentMemoryItem, setAgentMemoryCatalogEnabled, setAgentMemoryItemEnabled, updateAgentMemoryCatalog, updateAgentMemoryItem} from '../../memory/agent-memory-store';
import {createUserMemory, deleteUserMemory, readUserMemories, setUserMemoryEnabled, updateUserMemory} from '../../memory/memory-store';

import type {CommandHostApp} from '../../types/command';

/**
 * 创建用户 memory 和 agent memory catalog 的持久化端口。
 */
function createMemoryCommandPort(cwd: () => string): CommandHostApp['memory'] {
  return {
    list() {
      return readUserMemories();
    },
    create(content) {
      return createUserMemory(content);
    },
    update(id, content) {
      return updateUserMemory(id, content);
    },
    setEnabled(id, enabled) {
      return setUserMemoryEnabled(id, enabled);
    },
    delete(id) {
      return deleteUserMemory(id);
    },
    listAgentCatalogs() {
      return listAgentMemoryCatalogs(cwd());
    },
    readAgentCatalog(name, scope) {
      return readAgentMemoryCatalog(cwd(), name, scope);
    },
    addAgentMemory(input) {
      return addAgentMemory(cwd(), input);
    },
    updateAgentCatalog(name, updates, scope) {
      return updateAgentMemoryCatalog(cwd(), name, updates, scope);
    },
    setAgentCatalogEnabled(name, enabled, scope) {
      return setAgentMemoryCatalogEnabled(cwd(), name, enabled, scope);
    },
    updateAgentItem(catalog, itemId, content, scope) {
      return updateAgentMemoryItem(cwd(), catalog, itemId, content, scope);
    },
    setAgentItemEnabled(catalog, itemId, enabled, scope) {
      return setAgentMemoryItemEnabled(cwd(), catalog, itemId, enabled, scope);
    },
    removeAgentCatalog(name, scope) {
      return removeAgentMemoryCatalog(cwd(), name, scope);
    },
    removeAgentItem(catalog, itemId, scope) {
      return removeAgentMemoryItem(cwd(), catalog, itemId, scope);
    }
  };
}

export {
  createMemoryCommandPort
};
