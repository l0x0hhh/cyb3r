-- SQLite schema for the device-management data migration and future repository layer.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'other',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL,
  image TEXT,
  image_thumb TEXT,
  image_width INTEGER,
  image_height INTEGER,
  image_display_height INTEGER,
  image_display_position_y INTEGER,
  image_display_aspect_ratio REAL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'borrowed')),
  operational_status TEXT NOT NULL DEFAULT 'online' CHECK (operational_status IN ('online', 'offline')),
  offline_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  device_name TEXT NOT NULL,
  device_model TEXT NOT NULL DEFAULT '',
  is_other_device INTEGER NOT NULL DEFAULT 0 CHECK (is_other_device IN (0, 1)),
  other_device_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'borrow',
  borrower_name TEXT NOT NULL,
  borrower_id TEXT NOT NULL DEFAULT '',
  borrower_phone TEXT NOT NULL,
  major TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  returned_at TEXT,
  return_notes TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  deleted_by TEXT
  -- Keep the original device ID as a historical snapshot; deleted devices may no longer exist.
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  mask_sensitive_data INTEGER NOT NULL DEFAULT 1 CHECK (mask_sensitive_data IN (0, 1)),
  notify_borrow INTEGER NOT NULL DEFAULT 1 CHECK (notify_borrow IN (0, 1)),
  notify_return INTEGER NOT NULL DEFAULT 0 CHECK (notify_return IN (0, 1)),
  notify_admin_return INTEGER NOT NULL DEFAULT 0 CHECK (notify_admin_return IN (0, 1)),
  recipients_json TEXT NOT NULL DEFAULT '[]',
  smtp_json TEXT NOT NULL DEFAULT '{}',
  secret_encrypted TEXT NOT NULL DEFAULT '',
  subject_template TEXT NOT NULL DEFAULT '',
  body_template TEXT NOT NULL DEFAULT '',
  templates_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status, operational_status);
CREATE INDEX IF NOT EXISTS idx_records_active ON records(returned_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_records_borrower ON records(borrower_name, borrower_phone);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON operation_logs(created_at);
