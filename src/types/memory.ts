export type UserMemory = {
  id: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UserMemoryReadResult =
  | {ok: true; memories: UserMemory[]}
  | {ok: false; error: string};

export type UserMemoryMutationResult =
  | {ok: true; memories: UserMemory[]}
  | {ok: false; error: string};

export type AgentMemoryScope =
  | {kind: 'global'}
  | {kind: 'project'; projectRoot: string};

export type AgentMemoryCatalog = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: AgentMemoryScope;
};

export type AgentMemoryItem = {
  id: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentMemoryCatalogListResult =
  | {ok: true; catalogs: AgentMemoryCatalog[]}
  | {ok: false; error: string};

export type AgentMemoryCatalogReadResult =
  | {ok: true; catalog: AgentMemoryCatalog; memories: AgentMemoryItem[]}
  | {ok: false; error: string};

export type AgentMemoryMutationResult =
  | {ok: true; catalogs: AgentMemoryCatalog[]; catalog?: AgentMemoryCatalog; memories?: AgentMemoryItem[]; removedCatalog?: boolean}
  | {ok: false; error: string};
