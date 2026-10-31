CREATE TABLE inbox_notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 role user_role NOT NULL, type VARCHAR(80) NOT NULL, title VARCHAR(200) NOT NULL, body TEXT NOT NULL,
 data JSONB NOT NULL, created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at TIMESTAMPTZ(6)
);
CREATE INDEX idx_inbox_notifications_owner ON inbox_notifications(user_id,role,created_at,id);
