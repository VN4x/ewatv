-- Standalone auth: local users + roles; link existing owner_id columns.

CREATE TYPE user_role AS ENUM ('admin', 'user');

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role    user_role NOT NULL DEFAULT 'user',
  PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles (user_id);

-- FK owner_id → users(id); NOT VALID keeps migration safe when orphan UUIDs exist.
ALTER TABLE collections
  ADD CONSTRAINT collections_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;

ALTER TABLE videos
  ADD CONSTRAINT videos_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;

ALTER TABLE channels
  ADD CONSTRAINT channels_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;

ALTER TABLE schedules
  ADD CONSTRAINT schedules_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;

ALTER TABLE schedule_items
  ADD CONSTRAINT schedule_items_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;

COMMENT ON TABLE users IS 'Standalone playout backend accounts (no Supabase dependency)';
