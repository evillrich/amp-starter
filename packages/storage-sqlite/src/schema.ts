import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const workspaceItem = sqliteTable('workspace_item', {
  id: text('id').primaryKey(),                  // itm_...
  workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  kind: text('kind', { enum: ['folder','file'] }).notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  sortIndex: integer('sort_index').default(0).notNull(),
  isDeleted: integer('is_deleted', { mode:'boolean'}).default(false).notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode:'timestamp'}).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode:'timestamp'}).default(sql`CURRENT_TIMESTAMP`),
}, t => ({ byParent: uniqueIndex('u_ws_parent_slug').on(t.workspaceId, t.parentId, t.slug) }));

export const artifact = sqliteTable('artifact', {
  id: text('id').primaryKey(),                  // art_...
  itemId: text('item_id').notNull().references(() => workspaceItem.id, { onDelete: 'cascade' }),
  mimeType: text('mime_type'),                  // v0: text/markdown | text/plain | text/csv
});

export const artifactVersion = sqliteTable('artifact_version', {
  id: text('id').primaryKey(),                  // arv_...
  itemId: text('item_id').notNull().references(() => workspaceItem.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),        // 1..N (unique per item)
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256'),
  relPath: text('rel_path').notNull(),          // artifacts/<itemId>/v0001.bin
  comment: text('comment'),
  sourceRunId: text('source_run_id'),           // run_... (group by run)
  exportedAs: text('exported_as'),              // e.g., 'md'|'txt'|'csv'
  mergeBaseVersionId: text('merge_base_version_id'), // for 3-way merges (nullable)
  createdBy: text('created_by').notNull(),      // user_... or agent:<id>
  createdAt: integer('created_at', { mode: 'timestamp'}).default(sql`CURRENT_TIMESTAMP`),
}, t => ({ uItemVer: uniqueIndex('u_item_version').on(t.itemId, t.version) }));

export const run = sqliteTable('run', {
  id: text('id').primaryKey(),                  // run_...
  workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  assistantId: text('assistant_id').notNull(),
  engineId: text('engine_id').notNull(),
  inputText: text('input_text').notNull(),
  label: text('label'),
  tags: text('tags'),                           // JSON array
  startedAt: integer('started_at', { mode:'timestamp'}).default(sql`CURRENT_TIMESTAMP`),
  completedAt: integer('completed_at', { mode:'timestamp' }),
  status: text('status', { enum: ['ok','error','cancelled'] }).default('ok'),
});

export const runEvent = sqliteTable('run_event', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  at: integer('at', { mode:'timestamp'}).default(sql`CURRENT_TIMESTAMP`),
  kind: text('kind'),                            // model.called | tool.invoked | ...
  payload: text('payload'),                      // JSON string
});
