export * from "@amp/engine-spi"; // convenience re-exports

import type { AgentContext, ModelProvider, RunLogger } from "@amp/engine-spi";
import type { StorageBundle } from "@amp/engine-spi";

/** tiny id helper — stays pure */
export function randId(prefix: string) {
  const rnd = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rnd}`;
}

/** noop logger for tests */
export function noopLogger(): RunLogger {
  return { event() {} };
}

/** pure context builder — caller injects all env-specific deps */
export function createAgentContext(args: {
  projectId: string;
  inputText: string;
  model: ModelProvider;
  storage: StorageBundle;
  logger: RunLogger;
}): AgentContext {
  return {
    projectId: args.projectId,
    userId: "user_local",
    input: { text: args.inputText },
    tools: [],
    model: args.model,
    storage: args.storage,
    logger: args.logger
  };
}
