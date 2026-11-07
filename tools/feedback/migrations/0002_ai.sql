-- Agrega la marca de clasificación con IA (correr una vez en la base ya creada).
ALTER TABLE items ADD COLUMN ai_at TEXT;
ALTER TABLE items ADD COLUMN ai_title TEXT;
CREATE INDEX IF NOT EXISTS idx_items_ai ON items(ai_at);
