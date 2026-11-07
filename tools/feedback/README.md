# DUNK Feedback

Panel interno para ordenar el feedback del Discord de DUNK: lo que llega desde el juego (`player-feedback`), lo que escribe la gente en `player-feedback` y `beta-feedback`, y los posts del foro `bug-reports`.

- Corre en **Cloudflare Workers** (gratis) con una base de datos **D1**.
- Cada 5 minutos un bot de solo lectura revisa los canales y guarda lo nuevo. La primera vez se trae el historial de a poco (unas pocas corridas).
- Solo entran personas del servidor con el rol elegido, iniciando sesión con Discord.
- No escribe nada en Discord.

## Qué hace la app

La interfaz está en inglés y tiene dos modos (arriba a la izquierda). La primera vez muestra una bienvenida corta que explica cómo se usa.

- **Simple:** la foto general. Arriba dice cuánto falta revisar, con un botón grande **Start reviewing**. Debajo: nuevos de la semana, bugs abiertos y conversaciones del equipo; lo más pedido, de qué hablan los jugadores, las últimas conversaciones y lo que les gusta. Los gráficos de feedback por día y por estado están plegados en "More charts". Todo se puede tocar para ir al detalle, y se puede filtrar por versión.
- **Advanced:** para trabajar el feedback. Cada pestaña tiene una línea que explica para qué sirve.
  - **To review:** lo nuevo sin revisar. Eliges un estado y se abre el siguiente (`J`/`K` para moverte, `1`–`6` o `A`/`P`/`F`/`X` para el estado).
  - **All feedback:** todo. A la vista quedan la búsqueda, el tema y el orden (por ejemplo "Most requested"); el resto de filtros (origen, estado, sistema del juego, versión, duplicados) está en **Filters**, y los filtros activos se ven como etiquetas que se quitan con ×.
  - **Weekly review:** para la reunión semanal: qué mirar primero (personas que lo pidieron × prioridad), qué sistemas del juego se mencionan más esta semana y si los arreglos recientes funcionaron.
  - **Charts:** feedback por día y origen, mapa de temas × versión, progreso por versión, sistemas del juego y etiquetas.
  - El detalle de cada feedback muestra primero lo que dijo el jugador, el estado/tema/prioridad y el chat del equipo. Duplicados, etiquetas y notas, respuestas de Discord e historial quedan plegados y se abren con un clic (la app recuerda cuáles dejaste abiertos).
- Cada feedback se etiqueta solo con los **sistemas del juego** que menciona (tiro, dunk, robo, drible, pase, movimiento, stamina, cámara, tutorial, lobby, social, conexión, menús, bots, mapas) y se puede filtrar por eso.
- **IA de Cloudflare (Workers AI, gratis):** cada feedback nuevo lo lee una IA que decide el tema, qué partes del juego menciona y le pone un título corto si el texto es largo. Lo que el equipo confirma a mano siempre gana. Clasifica unos 10 por corrida (cada 5 minutos), así que lo viejo se va completando solo.
- **Spam:** las respuestas sin sentido (una palabra suelta, "asdf", puros emojis) quedan como Spam y no aparecen en la bandeja ni en los gráficos. Se ven eligiendo el tema "Spam"; con el botón **Not spam** vuelven, y con **Spam** (o la tecla `S`) se esconde uno a mano.
- **Mensajes largos:** cuando Discord convierte un mensaje largo en `message.txt`, la app lee el archivo y muestra el texto.
- **What players like:** la respuesta a "What did you enjoy most?" se guarda aparte y se muestra como lista, para no romper lo que gusta al cambiar cosas.
- **Team discussion:** en cada feedback el equipo puede comentar como en un chat, con su nombre de Discord. Los mensajes nuevos aparecen solos (cada ~8 segundos), la lista marca en naranja lo que tiene comentarios sin leer, y el modo Simple muestra las últimas conversaciones. Se ordena por "Recently discussed".
- **Download sheet:** descarga un CSV limpio con lo que estás viendo (respeta los filtros), listo para Google Sheets (Archivo → Importar → Subir) o Excel: fecha, versión, origen, tema, sistemas, estado, prioridad, cuántos lo piden, el texto, lo que le gustó y las notas.
- **Atajos:** `J`/`K` moverse, `A` revisado, `P` planeado, `F` arreglado, `X` descartado, `D` marcar duplicado, `C` comentar, `/` buscar.
- En cada feedback: estado, tema (sugerido automáticamente hasta que alguien lo confirma), prioridad, etiquetas, notas del equipo, duplicados ("Same thing"), respuestas del post del foro, historial y link a Discord.
- Modo claro u oscuro según el sistema, y funciona en el celular.

## Puesta en marcha (una sola vez)

### 1. Discord

1. En Discord, activa **Ajustes → Avanzado → Modo desarrollador** para poder copiar IDs con clic derecho.
2. En el [portal de desarrolladores](https://discord.com/developers/applications), abre la app que creaste:
   - **Bot**: con **Message Content Intent** activado, toca *Reset Token* y guarda el token para el paso 2.
   - **OAuth2**: copia el **Client ID** y el **Client Secret** (*Reset Secret*).
   - **OAuth2 → Redirects**: agrega `https://dunk-feedback.TU-SUBDOMINIO.workers.dev/auth/callback`. El subdominio lo muestra Cloudflare al hacer el deploy, así que puedes volver a este paso después.
3. Asegúrate de que el bot vea `bug-reports`, `player-feedback` y `beta-feedback`.

### 2. Cloudflare (desde esta carpeta, en la terminal)

```bash
npm install
npx wrangler login                          # abre el navegador para entrar a Cloudflare
npx wrangler d1 create dunk-feedback        # copia el database_id que imprime
```

Edita `wrangler.toml`:

- `database_id`: el que imprimió el comando anterior.
- `GUILD_ID`: clic derecho en el servidor de DUNK → *Copiar ID del servidor*.
- `DISCORD_CLIENT_ID`: el Client ID de la app.
- `CHANNELS`: reemplaza `ID_PLAYER_FEEDBACK`, `ID_BETA_FEEDBACK` e `ID_BUG_REPORTS` por los IDs de cada canal (clic derecho → *Copiar ID del canal*).
- `ALLOWED_ROLE_IDS`: ID del rol que puede entrar (Ajustes del servidor → Roles → clic derecho → *Copiar ID*). Pueden ser varios separados por coma.

Después:

```bash
npx wrangler d1 execute dunk-feedback --remote --file schema.sql
npx wrangler secret put DISCORD_BOT_TOKEN      # pega el token del bot
npx wrangler secret put DISCORD_CLIENT_SECRET  # pega el Client Secret
npx wrangler secret put SESSION_SECRET         # escribe cualquier frase larga y secreta
npx wrangler deploy
```

`deploy` imprime la URL (`https://dunk-feedback.….workers.dev`). Agrega esa URL + `/auth/callback` en los Redirects de Discord (paso 1.2), ábrela y entra con Discord. Toca **Actualizar** para leer Discord sin esperar los 5 minutos.

### Opcional: marcar lo viejo como revisado

Si en la primera carga la bandeja queda con cientos de mensajes viejos, esto marca como "Revisado" todo lo anterior a una fecha:

```bash
npx wrangler d1 execute dunk-feedback --remote --command "UPDATE items SET status='reviewed' WHERE status='new' AND created_at < '2026-10-01'"
```

### Opcional: importar la planilla de feedback

Exporta la planilla como CSV (Archivo → Descargar → CSV) y corre:

```bash
node scripts/import-sheet.mjs planilla.csv > import/import.sql
npx wrangler d1 execute dunk-feedback --remote --file import/import.sql
```

Ya está generado `import/import.sql` con las 64 respuestas de la planilla actual, así que basta con el segundo comando. La carpeta `import/` no se sube al repo porque tiene datos de jugadores.

Toma las columnas Date, Player, Origin, Feedback, Build, Location y Submission ID; cualquier otra columna se toma como una pregunta del formulario. Se puede correr varias veces sin duplicar, y si un envío también está en Discord queda una sola copia (la de Discord).

## Cambios y mantenimiento

- Si la base se creó antes de la IA, correr una vez: `npx wrangler d1 execute dunk-feedback --remote --file migrations/0002_ai.sql`.

- Para cambiar código: editar `src/` y correr `npx wrangler deploy`.
- Para ver qué hace el bot en cada corrida: `npx wrangler tail`.
- Si se agrega otro canal, súmalo a `CHANNELS` (`id:nombre:text` o `id:nombre:forum`) y despliega.

## Probar en local

```bash
cp .dev.vars.example .dev.vars   # completa los valores (o usa DEV_NO_AUTH=1 para saltar el login)
npx wrangler d1 execute dunk-feedback --local --file schema.sql
npx wrangler dev --test-scheduled
```

## Archivos

| Archivo | Qué es |
| --- | --- |
| `src/index.js` | Rutas de la app y API, y la tarea programada |
| `src/sync.js` | Lectura de Discord (canales de texto y foro) con un límite de llamadas por corrida |
| `src/parse.js` | Convierte mensajes y embeds del juego en feedback y sugiere la categoría |
| `src/auth.js` | Login con Discord y chequeo del rol |
| `src/app.html` | La interfaz |
| `schema.sql` | Tablas de la base de datos |

## Clasificación más precisa (nov 2026)

- La IA usa ahora `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (el 8B confundía mucho, por ejemplo marcaba UI sin que se hablara de menús). Gasta más cuota gratis diaria; si se acaba, la clasificación sigue sola al día siguiente.
- Instrucciones nuevas con reglas y ejemplos: un mecanismo confuso es *gameplay*, no *ui*; *ui* es solo menús, HUD, ajustes y marcador. Las partes del juego solo se marcan si el jugador las nombra.
- Se sacaron palabras clave ambiguas de UI ("confusing", "unclear", "guide", "icon"…).
- Los tags de "Mentions" se pueden quitar (×) o agregar (+ Add) a mano. Una vez que el equipo los toca, la IA no los vuelve a cambiar (columna `systems_by_team`).

Para publicarlo:

```
npx wrangler d1 execute dunk-feedback --remote --file migrations/0003_systems_by_team.sql
# en wrangler.toml, AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" (o borrar la línea)
npx wrangler deploy
# reclasificar todo con la IA nueva (lo que el equipo confirmó a mano no se toca):
npx wrangler d1 execute dunk-feedback --remote --command "UPDATE items SET ai_at = NULL"
```
