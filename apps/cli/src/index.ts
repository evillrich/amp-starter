import path from "path";
import { Command } from "commander";
import { BasicEngine } from "@amp/engine-basic";
import { EchoModel } from "@amp/model-provider";
import { createSqlite } from "@amp/storage-sqlite";
import { createAgentContext, randId } from "@amp/sdk";
import { createFileRunLogger } from "@amp/logger-file";

const program = new Command();
program.name("amp").description("Amp CLI (v0)").version("0.1.0");
program.enablePositionalOptions();

function resolveDataDir(opt?: string) {
  const base = opt ?? process.env.AMP_DATA_DIR ?? process.env.INIT_CWD ?? process.cwd();
  return path.resolve(base, ".amp");
}

// allow subcommand options after the command and handle pnpm's injected leading `--`
program.enablePositionalOptions();
const rawArgv = process.argv.slice(2);
const cleanedArgv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;

// --- helpers -----------------------------------------------------------------
function callCwd() {
  return process.env.INIT_CWD || process.cwd();
}

function getDataDir(opt?: string) {
  const base = callCwd();
  return opt ? path.resolve(base, opt) : path.resolve(base, ".amp");
}

// --- project (project) group ----------------------------------------------------
const project = program
  .command("project")
  .description("Project commands")
  .option("--data <dir>", "Data directory (default: ./.amp)");

project
  .command("create <name>")
  .description("Create a project")
  .action(async (name) => {
    const parentOpts = project.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const { id } = await s.createProject(name);
    console.log(id);
  });

project
  .command("list")
  .description("List projects")
  .action(async () => {
    const parentOpts = project.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const rows = await s.listProjects();
    if (!rows.length) return console.log("(none)");
    for (const w of rows) console.log(`${w.id}\t${w.name}`);
  });

project
  .command("show <projectId>")
  .description("Show a project")
  .action(async (projectId) => {
    const parentOpts = project.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const w = await s.getProject(projectId);
    if (!w) return console.error("Not found");
    console.log(JSON.stringify(w, null, 2));
  });

// --- project artifact -------------------------------------------------------------
const artifact = project.command("artifact").description("Artifact commands");

artifact
  .command("add <projectId> <path>")
  .description("Add a file as a versioned artifact")
  .option("--name <label>", "Display name (defaults to filename)")
  .option("--comment <comment>", "Version comment")
  .action(async (projectId, filePath, opts) => {
    const parentOpts = project.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const absPath = path.resolve(callCwd(), filePath);   // ← resolve against caller dir
    const res = await s.addArtifactFromFile(projectId, absPath, {
      name: opts.name,
      comment: opts.comment,
      createdBy: "user_local",
    });
    console.log(`${res.artifactId}\t${res.itemId}\tv${res.version}`);
  });

artifact
  .command("history <artifactId>")
  .description("Show artifact versions")
  .action(async (artifactId) => {
    const parentOpts = project.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const rows = await s.getArtifactHistory(artifactId);
    if (!rows.length) return console.log("(none)");
    for (const r of rows) {
      console.log(`v${r.version}\t${r.size_bytes}B\t${r.sha256?.slice(0, 8) ?? ""}...\t${r.rel_path}${r.comment ? "  # " + r.comment : ""}`);
    }
  });

artifact
  .command("export <artifactId>")
  .description("Export an artifact version to a file")
  .option("--version <v>", "Version number or 'latest'", "latest")
  .option("--out <path>", "Output file path")
  .action(async (artifactId, opts: { version: string; out?: string }) => {
    const parentOpts = project.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const v = opts.version === "latest" ? "latest" : Number(String(opts.version).replace(/^v/i, ""));
    const out = opts.out ? path.resolve(callCwd(), opts.out) : undefined;  // ← here
    const exported = await s.exportArtifactVersion(artifactId, v as any, out);
    console.log(exported);
  });

// --- run ---------------------------------------------------------------------
program
  .command("run <assistantId> <projectId>")
  .description("Run an assistant")
  .option("--input <text>", "Input prompt", "")
  .option("--data <dir>", "Data directory (default: ./.amp)")
  .action(async (_assistantId, projectId, opts) => {
    const dataDir = resolveDataDir(opts.data);
    const runId = randId("run");

    const storage = createSqlite(dataDir);
    const logger = createFileRunLogger({ dataDir, runId, projectId });
    const model = new EchoModel();
    const engine = new BasicEngine();

    const ctx = createAgentContext({
      projectId,
      inputText: opts.input || "",
      model,
      storage,
      logger
    });

    logger.event("run.started", { assistantId: _assistantId });

    try {
      const res = await engine.runTurn(ctx);
      const out = res.messages?.[0]?.content ?? "";
      console.log(out);
      logger.event("model.response", { text: out });
      logger.event("run.finished", { status: "ok" });
    } catch (err: any) {
      logger.event("run.error", { message: String(err?.message || err) });
      throw err;
    } finally {
      (logger as any).close?.();
    }
  });

program.parseAsync(cleanedArgv, { from: "user" });
