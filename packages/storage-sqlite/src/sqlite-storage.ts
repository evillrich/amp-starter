import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import type { StorageBundle } from "@amp/engine-spi";

type ProjectRow = { id: string; name: string; created_at: number };
type ItemRow = {
  id: string;
  project_id: string;
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
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS project_item (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
      parent_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('folder','file')),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      sort_index INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE (project_id, parent_id, slug)
    );

    CREATE TABLE IF NOT EXISTS artifact (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES project_item(id) ON DELETE CASCADE,
      mime_type TEXT
    );

    CREATE TABLE IF NOT EXISTS artifact_version (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES project_item(id) ON DELETE CASCADE,
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
  getProject(id: string): Promise<ProjectRow | undefined>;
  addArtifactFromFile(
    projectId: string,
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
    async createProject(name: string) {
      const id = randId("proj");
      db.prepare(`INSERT INTO project (id, name) VALUES (?, ?)`).run(id, name);
      return { id, name };
    },
    async listProjects() {
      const rows = db.prepare(`SELECT id, name FROM project ORDER BY created_at DESC`).all() as Array<{
        id: string;
        name: string;
      }>;
      return rows;
    },

    // --- extras we use from CLI ---
    async getProject(id: string) {
      const row = db.prepare(`SELECT id, name, created_at FROM project WHERE id = ?`).get(id) as
        | ProjectRow
        | undefined;
      return row;
    },

    async addArtifactFromFile(projectId, filePath, opts) {
      const project = db.prepare(`SELECT id FROM project WHERE id = ?`).get(projectId) as { id: string } | undefined;
      if (!project) throw new Error(`Project not found: ${projectId}`);

      const createdBy = opts?.createdBy ?? "user_local";
      const fileBytes = fs.readFileSync(filePath);
      const size = fileBytes.byteLength;
      const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
      const name = opts?.name ?? path.basename(filePath);
      const slugBase = slugify(name);
      const mime = detectMime(filePath);

      // Unique slug within (projectId, parentId=null)
      let slug = slugBase || randId("file");
      for (; ;) {
        const exists = db
          .prepare(
            `SELECT 1 FROM project_item WHERE project_id = ? AND parent_id IS NULL AND slug = ? LIMIT 1`
          )
          .get(projectId, slug);
        if (!exists) break;
        slug = `${slugBase}-${crypto.randomBytes(2).toString("hex")}`;
      }

      const tx = db.transaction(() => {
        const itemId = randId("itm");
        db.prepare(
          `INSERT INTO project_item
            (id, project_id, parent_id, kind, name, slug, sort_index, is_deleted, created_by)
           VALUES (?, ?, NULL, 'file', ?, ?, 0, 0, ?)`
        ).run(itemId, projectId, name, slug, createdBy);

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
