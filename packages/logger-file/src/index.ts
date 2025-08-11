import fs from "fs";
import path from "path";
import type { RunLogger } from "@amp/engine-spi";

export type FileRunLoggerOpts = {
  dataDir: string;
  runId: string;
  projectId?: string;
};

export function createFileRunLogger(opts: FileRunLoggerOpts): RunLogger & { close(): void, file: string } {
  const runsDir = path.join(opts.dataDir, "runs");
  fs.mkdirSync(runsDir, { recursive: true });

  const file = path.join(runsDir, `run_${opts.runId}.jsonl`);
  const stream = fs.createWriteStream(file, { flags: "a" });

  const log: RunLogger["event"] = (kind, payload) => {
    const rec = {
      ts: new Date().toISOString(),
      runId: opts.runId,
      projectId: opts.projectId,
      kind,
      payload
    };
    stream.write(JSON.stringify(rec) + "\n");
  };

  return { event: log, close: () => stream.end(), file };
}
