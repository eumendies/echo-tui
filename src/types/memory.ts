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
