-- Feedback de DUNK: cada mensaje o post de Discord es un "item".
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,              -- id del mensaje (o del post del foro)
  source TEXT NOT NULL,             -- game | player-feedback | beta-feedback | bug-reports
  channel_id TEXT NOT NULL,
  thread_id TEXT,                   -- post del foro al que pertenece
  url TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  title TEXT,                       -- título del post del foro
  content TEXT,                     -- texto plano (para buscar)
  fields TEXT,                      -- JSON [{q, a}] de los embeds del juego
  attachments TEXT,                 -- JSON [{url, name, type}]
  forum_tags TEXT,                  -- JSON [nombre] de tags del foro
  build TEXT,                       -- ej. 0.6.8
  context TEXT,                     -- ej. post-match, pause-menu
  mode TEXT,                        -- ej. Lobby
  submission_id TEXT,
  reactions INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  -- Lo que agrega el equipo
  status TEXT NOT NULL DEFAULT 'new',  -- new | reviewed | planned | in_progress | fixed | wontfix
  category TEXT,                       -- bug | idea | balance | controls | performance | maps | ui | audio | network | other
  auto_category TEXT,                  -- sugerida automáticamente
  systems TEXT NOT NULL DEFAULT '[]',  -- JSON: sistemas del juego mencionados (shooting, dunk, steal…)
  liked TEXT,                          -- lo que le gustó al jugador (respuesta del formulario)
  voice TEXT NOT NULL DEFAULT '{}',    -- JSON {love,pain,want}: partes del juego por cada una de las 3 preguntas
  ai_title TEXT,                       -- título corto que puso la IA
  systems_by_team INTEGER DEFAULT 0,   -- 1 = el equipo corrigió los systems; la IA no los toca
  ai_at TEXT,                          -- cuándo lo clasificó la IA (NULL = pendiente)
  priority INTEGER,                    -- 1 alta, 2 media, 3 baja
  tags TEXT NOT NULL DEFAULT '[]',     -- JSON [string]
  notes TEXT,
  duplicate_of TEXT,                   -- id del item principal si es duplicado
  updated_at TEXT,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at);
CREATE INDEX IF NOT EXISTS idx_items_dup ON items(duplicate_of);

-- Respuestas dentro de un post del foro o respuestas a un mensaje.
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  author_name TEXT,
  content TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_id);

-- Historial de cambios del equipo.
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_item ON activity(item_id);

-- Hasta dónde se leyó cada canal.
CREATE TABLE IF NOT EXISTS cursors (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Conversación del equipo sobre cada feedback.
CREATE TABLE IF NOT EXISTS team_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  avatar TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_item ON team_messages(item_id, id);
CREATE INDEX IF NOT EXISTS idx_team_created ON team_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_items_ai ON items(ai_at);
CREATE INDEX IF NOT EXISTS idx_items_submission ON items(submission_id);
CREATE INDEX IF NOT EXISTS idx_items_ai_created ON items(ai_at, created_at);
