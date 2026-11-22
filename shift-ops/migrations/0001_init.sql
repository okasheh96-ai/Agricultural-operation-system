-- shift-ops schema v1. Quantities and money are INTEGER thousandths plus a unit/currency code (no floats).
-- Instants are UTC ISO-8601 text or epoch ms; shift dates are local (Asia/Amman) YYYY-MM-DD.
-- No hard deletes on records that feed results: rows are voided/superseded with a reason.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE access_grants (
  email TEXT PRIMARY KEY CHECK (email = lower(email) AND email LIKE '%_@_%'),
  display_name TEXT,
  show_workers INTEGER NOT NULL DEFAULT 0 CHECK (show_workers IN (0,1)),
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE ref_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('product','grade','line','unit','customer','downtime_reason','currency')),
  code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
  name_ar TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  attrs TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, code)
);

CREATE TABLE conversions (
  id TEXT PRIMARY KEY,
  product TEXT,
  grade TEXT,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  factor INTEGER NOT NULL CHECK (factor > 0),
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  CHECK (from_unit <> to_unit)
);

CREATE TABLE lots (
  lot TEXT PRIMARY KEY,
  closed_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  r2_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sheet','image')),
  uploaded_at TEXT NOT NULL
);
CREATE INDEX files_sha ON files(sha256);

CREATE TABLE mappings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dataset TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('sheet','photo','manual')),
  file_id TEXT REFERENCES files(id),
  mapping_id TEXT REFERENCES mappings(id),
  sheet TEXT,
  dataset TEXT NOT NULL,
  shift_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('receiving','staged','approved','rejected','superseded')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  received_rows INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  duplicate_of TEXT,
  supersedes_batch_id TEXT REFERENCES batches(id),
  superseded_by TEXT,
  reading_mode TEXT NOT NULL DEFAULT 'interval' CHECK (reading_mode IN ('interval','cumulative','event')),
  config TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  reject_reason TEXT
);
CREATE INDEX batches_status ON batches(status, shift_date);
CREATE INDEX batches_hash ON batches(content_hash);

CREATE TABLE staged_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  idx INTEGER NOT NULL,
  source_ref TEXT,
  raw TEXT NOT NULL,
  vals TEXT NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  excluded INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0,1)),
  exclude_reason TEXT,
  resolution TEXT CHECK (resolution IN ('supersede','keep_both')),
  updated_at TEXT NOT NULL,
  UNIQUE (batch_id, idx)
);

CREATE TABLE row_edits (
  id TEXT PRIMARY KEY,
  row_id TEXT NOT NULL REFERENCES staged_rows(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  actor TEXT NOT NULL
);

CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  row_id TEXT REFERENCES staged_rows(id),
  dataset TEXT NOT NULL,
  shift_date TEXT NOT NULL,
  at_ms INTEGER, start_ms INTEGER, end_ms INTEGER,
  line TEXT, product TEXT, grade TEXT, lot TEXT, customer TEXT, order_ref TEXT, worker TEXT, reason TEXT,
  doc_no TEXT, ref_doc_no TEXT, rec_status TEXT, direction TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('interval','cumulative','event')),
  metric TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit TEXT NOT NULL,
  source_ref TEXT,
  attrs TEXT,
  natural_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'current' CHECK (state IN ('current','superseded')),
  superseded_by_batch TEXT,
  approved_at TEXT NOT NULL
);
CREATE INDEX facts_current ON facts(state, dataset, shift_date);
CREATE INDEX facts_nk ON facts(natural_key, state);
CREATE INDEX facts_batch ON facts(batch_id);

-- Approved facts are immutable except for being superseded once.
CREATE TRIGGER facts_immutable BEFORE UPDATE ON facts
WHEN NEW.qty IS NOT OLD.qty OR NEW.unit IS NOT OLD.unit OR NEW.metric IS NOT OLD.metric OR NEW.dataset IS NOT OLD.dataset
  OR NEW.natural_key IS NOT OLD.natural_key OR NEW.batch_id IS NOT OLD.batch_id OR OLD.state = 'superseded'
BEGIN SELECT RAISE(ABORT, 'approved facts are immutable; supersede them with a new batch'); END;
CREATE TRIGGER facts_no_delete BEFORE DELETE ON facts BEGIN SELECT RAISE(ABORT, 'no hard deletes'); END;

CREATE TABLE metric_rules (
  dataset TEXT NOT NULL,
  metric TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quantity','count','rate','price','balance','duration')),
  aggregation TEXT NOT NULL CHECK (aggregation IN ('sum','latest','avg')),
  label_ar TEXT NOT NULL DEFAULT '',
  label_en TEXT NOT NULL DEFAULT '',
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset, metric),
  CHECK (aggregation = 'sum' OR kind IN ('rate','price','balance'))
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  shift_date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE plan_versions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  n INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','discarded')),
  data TEXT NOT NULL,
  based_on TEXT REFERENCES plan_versions(id),
  effective_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (plan_id, n),
  CHECK (status <> 'published' OR published_at IS NOT NULL),
  CHECK (n = 1 OR status <> 'published' OR (effective_at IS NOT NULL AND length(trim(reason)) > 0))
);
CREATE UNIQUE INDEX one_draft_per_plan ON plan_versions(plan_id) WHERE status = 'draft';
CREATE TRIGGER plan_published_frozen BEFORE UPDATE ON plan_versions
WHEN OLD.status = 'published' AND (NEW.data IS NOT OLD.data OR NEW.status IS NOT OLD.status OR NEW.effective_at IS NOT OLD.effective_at)
BEGIN SELECT RAISE(ABORT, 'a published plan version is frozen'); END;
CREATE TRIGGER plan_versions_no_delete BEFORE DELETE ON plan_versions BEGIN SELECT RAISE(ABORT, 'no hard deletes'); END;

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  recipients TEXT NOT NULL DEFAULT '[]',
  params TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  trigger TEXT NOT NULL,
  prefix TEXT NOT NULL,
  manifest TEXT,
  error TEXT
);

CREATE TABLE restore_tests (
  id TEXT PRIMARY KEY,
  backup_id TEXT NOT NULL REFERENCES backup_runs(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','passed','failed')),
  report TEXT
);

CREATE TABLE ai_usage (
  month TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  neurons INTEGER NOT NULL DEFAULT 0
);

INSERT INTO settings(key, value) VALUES
  ('data_version', '0'),
  ('timezone', '"Asia/Amman"'),
  ('lot_tol_abs_kg', '0'),
  ('lot_tol_pct', '0'),
  ('pace_tol_pct', '0'),
  ('rate_tol_pct', '0'),
  ('ai_enabled', 'false'),
  ('ai_monthly_call_limit', '0'),
  ('ocr_threshold', '80'),
  ('default_shift_start', '"06:00"'),
  ('guide_dismissed', 'false'),
  ('show_workers_to_viewers', 'false');

-- Used to abort an approval batch atomically when a concurrent request already approved it:
-- inserting NULL violates NOT NULL and rolls back the whole D1 batch.
CREATE TABLE guard (ok INTEGER NOT NULL CHECK (ok = 1));
