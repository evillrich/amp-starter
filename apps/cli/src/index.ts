import { Command } from "commander";
import { createDefaultContext } from "@amp/sdk";
import { BasicEngine } from "@amp/engine-basic";
import { createSqlite } from "@amp/storage-sqlite";
import path from "path";

const program = new Command();
program.name("amp").description("Amp CLI (v0 skeleton)").version("0.1.0");

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

// --- ws (workspace) group ----------------------------------------------------
const ws = program
  .command("ws")
  .description("Workspace commands")
  .option("--data <dir>", "Data directory (default: ./.amp)");

ws
  .command("create <name>")
  .description("Create a workspace")
  .action(async (name) => {
    const parentOpts = ws.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const { id } = await s.createWorkspace(name);
    console.log(id);
  });

ws
  .command("list")
  .description("List workspaces")
  .action(async () => {
    const parentOpts = ws.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const rows = await s.listWorkspaces();
    if (!rows.length) return console.log("(none)");
    for (const w of rows) console.log(`${w.id}\t${w.name}`);
  });

ws
  .command("show <workspaceId>")
  .description("Show a workspace")
  .action(async (workspaceId) => {
    const parentOpts = ws.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const w = await s.getWorkspace(workspaceId);
    if (!w) return console.error("Not found");
    console.log(JSON.stringify(w, null, 2));
  });

// --- ws artifact -------------------------------------------------------------
const artifact = ws.command("artifact").description("Artifact commands");

artifact
  .command("add <workspaceId> <path>")
  .description("Add a file as a versioned artifact")
  .option("--name <label>", "Display name (defaults to filename)")
  .option("--comment <comment>", "Version comment")
  .action(async (workspaceId, filePath, opts) => {
    const parentOpts = ws.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const absPath = path.resolve(callCwd(), filePath);   // ← resolve against caller dir
    const res = await s.addArtifactFromFile(workspaceId, absPath, {
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
    const parentOpts = ws.opts<{ data?: string }>();
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
    const parentOpts = ws.opts<{ data?: string }>();
    const s = createSqlite(getDataDir(parentOpts.data));
    const v = opts.version === "latest" ? "latest" : Number(String(opts.version).replace(/^v/i, ""));
    const out = opts.out ? path.resolve(callCwd(), opts.out) : undefined;  // ← here
    const exported = await s.exportArtifactVersion(artifactId, v as any, out);
    console.log(exported);
  });

// --- run ---------------------------------------------------------------------
program
  .command("run <assistantId> <workspaceId>")
  .description("Run an assistant")
  .option("--input <text>", "Input prompt", "")
  .option("--auto-approve", "Auto-accept changes (no review)", false)
  .option("--label <label>", "Run label")
  .option("--tag <tag...>", "Tags (space-separated)", [])
  .action(async (_assistantId, workspaceId, opts) => {
    const engine = new BasicEngine();
    const ctx = createDefaultContext(workspaceId, opts.input || "");
    const res = await engine.runTurn(ctx);
    if (res.messages?.length) {
      console.log(res.messages[0].content ?? "");
    }
  });

program.parseAsync(cleanedArgv, { from: "user" });
