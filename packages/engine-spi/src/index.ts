export interface ToolDescriptor {
  name: string;
  description?: string;
}

export interface ModelProvider {
  id(): string;
  chat(prompt: string): Promise<string>;
}

export interface StorageBundle {
  // v0 minimal – expand later
  createWorkspace(name: string): Promise<{ id: string; name: string }>;
  listWorkspaces(): Promise<Array<{ id: string; name: string }>>;
}

export interface RunLogger {
  event(kind: string, payload?: unknown): void;
}

export interface AgentContext {
  workspaceId: string;
  userId: string;
  input: { text: string };
  tools: ToolDescriptor[];
  model: ModelProvider;
  storage: StorageBundle;
  logger: RunLogger;
}

export interface AgentResult {
  messages: Array<{ role: 'assistant' | 'tool'; content: string }>;
  artifacts?: Array<{ itemId: string; version: number }>;
}

export interface AgentEngine {
  id: string;
  capabilities(): string[];
  runTurn(ctx: AgentContext): Promise<AgentResult>;
}
