-- Índices para que la sincronización y la IA no recorran la tabla entera.
CREATE INDEX IF NOT EXISTS idx_items_submission ON items(submission_id);
CREATE INDEX IF NOT EXISTS idx_items_ai_created ON items(ai_at, created_at);
