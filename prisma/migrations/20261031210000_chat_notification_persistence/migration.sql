CREATE TABLE IF NOT EXISTS chat_messages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT, sender_role user_role NOT NULL,
 text TEXT NOT NULL, image_url VARCHAR(500), status VARCHAR(20) NOT NULL DEFAULT 'SENT', read_at TIMESTAMPTZ(6),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL
);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_message_client ON chat_messages(booking_id,sender_user_id,client_message_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_booking_created ON chat_messages(booking_id,created_at);
CREATE TABLE IF NOT EXISTS device_tokens (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 token VARCHAR(500) NOT NULL, role user_role NOT NULL, platform VARCHAR(20) NOT NULL DEFAULT 'ANDROID', language VARCHAR(10) NOT NULL DEFAULT 'en',
 is_active BOOLEAN NOT NULL DEFAULT true, last_seen_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_tokens_token ON device_tokens(token);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_role ON device_tokens(user_id,role);
CREATE TABLE IF NOT EXISTS notification_preferences (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 push_enabled BOOLEAN NOT NULL DEFAULT true, sound_enabled BOOLEAN NOT NULL DEFAULT true, language VARCHAR(10) NOT NULL DEFAULT 'en',
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_user ON notification_preferences(user_id);
