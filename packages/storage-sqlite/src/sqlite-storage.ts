import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import type { StorageBundle } from "@amp/engine-spi";

type WorkspaceRow = { id: string; name: string; created_at: number };
type ItemRow = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  kind: "folder" | "file";
  name: string;
  slug: string;
  sort_index: number;
  is_deleted: number;
  created_by: string;
  created_at: number;
  updated_at: number;
};
type ArtifactRow = { id: string; item_id: string; mime_type: string | null };
type VersionRow = {
  id: string;
  item_id: string;
  version: number;
  size_bytes: number;
  sha256: string;
  rel_path: string;
  comment: string | null;
  source_run_id: string | null;
  exported_as: string | null;
  merge_base_version_id: string | null;
  created_by: string;
  created_at: number;
};

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function randId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}
function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function detectMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".md") return "text/markdown";
  if (ext === ".csv") return "text/csv";
  return "text/plain";
}

// helper to map mime -> default extension
function extFor(mime: string | null | undefined) {
  if (mime === "text/markdown") return ".md";
  if (mime === "text/csv") return ".csv";
  return ".txt";
}


function bootstrap(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_item (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      parent_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('folder','file')),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      sort_index INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE (workspace_id, parent_id, slug)
    );

    CREATE TABLE IF NOT EXISTS artifact (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES workspace_item(id) ON DELETE CASCADE,
      mime_type TEXT
    );

    CREATE TABLE IF NOT EXISTS artifact_version (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES workspace_item(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      rel_path TEXT NOT NULL,
      comment TEXT,
      source_run_id TEXT,
      exported_as TEXT,
      merge_base_version_id TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE (item_id, version)
    );
  `);
}

function openDb(dataDir: string) {
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, "amp.db");
  const db = new Database(dbPath);
  bootstrap(db);
  return db;
}

/** Rich API we’ll use from the CLI. Also satisfies the minimal StorageBundle. */
export interface SqliteApi extends StorageBundle {
  getWorkspace(id: string): Promise<WorkspaceRow | undefined>;
  addArtifactFromFile(
    workspaceId: string,
    filePath: string,
    opts?: { name?: string; comment?: string; createdBy?: string }
  ): Promise<{ artifactId: string; itemId: string; version: number }>;
  getArtifactHistory(artifactId: string): Promise<VersionRow[]>;
  exportArtifactVersion(artifactId: string, version: number | "latest", outPath?: string): Promise<string>;
}

export function createSqlite(dataDir: string): SqliteApi {
  const db = openDb(dataDir);

  return {
    // --- StorageBundle (minimal) ---
    async createWorkspace(name: string) {
      const id = randId("ws");
      db.prepare(`INSERT INTO workspace (id, name) VALUES (?, ?)`).run(id, name);
      return { id, name };
    },
    async listWorkspaces() {
      const rows = db.prepare(`SELECT id, name FROM workspace ORDER BY created_at DESC`).all() as Array<{
        id: string;
        name: string;
      }>;
      return rows;
    },

    // --- extras we use from CLI ---
    async getWorkspace(id: string) {
      const row = db.prepare(`SELECT id, name, created_at FROM workspace WHERE id = ?`).get(id) as
        | WorkspaceRow
        | undefined;
      return row;
    },

    async addArtifactFromFile(workspaceId, filePath, opts) {
      const ws = db.prepare(`SELECT id FROM workspace WHERE id = ?`).get(workspaceId) as { id: string } | undefined;
      if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);

      const createdBy = opts?.createdBy ?? "user_local";
      const fileBytes = fs.readFileSync(filePath);
      const size = fileBytes.byteLength;
      const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
      const name = opts?.name ?? path.basename(filePath);
      const slugBase = slugify(name);
      const mime = detectMime(filePath);

      // Unique slug within (workspaceId, parentId=null)
      let slug = slugBase || randId("file");
      for (; ;) {
        const exists = db
          .prepare(
            `SELECT 1 FROM workspace_item WHERE workspace_id = ? AND parent_id IS NULL AND slug = ? LIMIT 1`
          )
          .get(workspaceId, slug);
        if (!exists) break;
        slug = `${slugBase}-${crypto.randomBytes(2).toString("hex")}`;
      }

      const tx = db.transaction(() => {
        const itemId = randId("itm");
        db.prepare(
          `INSERT INTO workspace_item
            (id, workspace_id, parent_id, kind, name, slug, sort_index, is_deleted, created_by)
           VALUES (?, ?, NULL, 'file', ?, ?, 0, 0, ?)`
        ).run(itemId, workspaceId, name, slug, createdBy);

        const artifactId = randId("art");
        db.prepare(`INSERT INTO artifact (id, item_id, mime_type) VALUES (?, ?, ?)`).run(artifactId, itemId, mime);

        // Next version number
        const maxVerRow = db
          .prepare(`SELECT COALESCE(MAX(version), 0) as maxv FROM artifact_version WHERE item_id = ?`)
          .get(itemId) as { maxv: number };
        const nextVer = (maxVerRow?.maxv ?? 0) + 1;

        // Write bytes to disk
        const artifactsDir = path.join(path.dirname(db.name), "artifacts", itemId);
        ensureDir(artifactsDir);
        const relPath = path.posix.join("artifacts", itemId, `v${String(nextVer).padStart(4, "0")}.bin`);
        const absPath = path.join(path.dirname(db.name), relPath);
        fs.writeFileSync(absPath, fileBytes);

        const arvId = randId("arv");
        db.prepare(
          `INSERT INTO artifact_version
             (id, item_id, version, size_bytes, sha256, rel_path, comment, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(arvId, itemId, nextVer, size, sha256, relPath, opts?.comment ?? null, createdBy);

        return { artifactId, itemId, version: nextVer };
      });

      return tx();
    },

    async getArtifactHistory(artifactId) {
      const art = db.prepare(`SELECT item_id FROM artifact WHERE id = ?`).get(artifactId) as
        | { item_id: string }
        | undefined;
      if (!art) return [];
      const rows = db
        .prepare(
          `SELECT id, item_id, version, size_bytes, sha256, rel_path, comment, source_run_id, exported_as, merge_base_version_id, created_by, created_at
             FROM artifact_version
             WHERE item_id = ?
             ORDER BY version ASC`
        )
        .all(art.item_id) as VersionRow[];
      return rows;
    },

    async exportArtifactVersion(artifactId, version, outPath) {
      const art = db.prepare(`SELECT item_id, mime_type FROM artifact WHERE id = ?`).get(artifactId) as
        | { item_id: string; mime_type: string | null }
        | undefined;
      if (!art) throw new Error(`Artifact not found: ${artifactId}`);

      const row = version === "latest"
        ? (db.prepare(
          `SELECT * FROM artifact_version WHERE item_id = ? ORDER BY version DESC LIMIT 1`
        ).get(art.item_id) as VersionRow | undefined)
        : (db.prepare(
          `SELECT * FROM artifact_version WHERE item_id = ? AND version = ?`
        ).get(art.item_id, version) as VersionRow | undefined);

      if (!row) throw new Error(`Version not found for artifact ${artifactId} (${String(version)})`);

      const absSrc = path.join(path.dirname(db.name), row.rel_path);
      const baseCwd = process.env.INIT_CWD || process.cwd();
      const chosenOut =
        outPath ||
        path.join(baseCwd, `${artifactId}-v${String(row.version).padStart(4, "0")}${extFor(art.mime_type)}`);

      ensureDir(path.dirname(chosenOut));
      fs.copyFileSync(absSrc, chosenOut);
      return chosenOut;
    },
  };
}
