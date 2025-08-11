import { BasicEngine } from "@amp/engine-basic";
import { EchoModel } from "@amp/model-provider";
import { createSqlite } from "@amp/storage-sqlite";
import type { AgentContext, RunLogger } from "@amp/engine-spi";
import fs from "fs";
import path from "path";
import crypto from "crypto";

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function getDataDir() {
  return process.env.AMP_DATA || path.resolve(process.cwd(), ".amp");
}

function newRunId() {
  return `run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

export function createLogger(runId = newRunId()): RunLogger {
  const dataDir = getDataDir();
  const runsDir = path.join(dataDir, "runs");
  ensureDir(runsDir);
  const logPath = path.join(runsDir, `${runId}.jsonl`);
  return {
    event(kind, payload) {
      const rec = { ts: Date.now(), kind, payload };
      fs.appendFileSync(logPath, JSON.stringify(rec) + "\n");
      // mirror to console for dev:
      console.log(`[${runId}] ${kind}`, payload ?? "");
    }
  };
}

export function createDefaultContext(workspaceId: string, inputText: string): AgentContext {
  const model = new EchoModel();
  const storage = createSqlite(getDataDir());
  const logger = createLogger(); // new run id each time

  return {
    workspaceId,
    userId: "user_local",
    input: { text: inputText },
    tools: [],
    model,
    storage,
    logger
  };
}
