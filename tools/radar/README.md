# Radar DUNK

Rastrea lo que se sube sobre DUNK en redes. Es un solo script de Node, sin dependencias. Todo se guarda en `db.json`.

```
node tools/radar/radar.mjs scan
```

Busca posts nuevos, actualiza visitas y deja `report.md` (para leer) y `posts.csv` (para planillas).

## Cómo busca

| Fuente | Cómo | Costo |
|---|---|---|
| YouTube, búsqueda | 14 búsquedas en 8 idiomas con filtro "esta semana" (`config.json`) | ~350 KB por búsqueda |
| YouTube, creadores | Últimos 15 videos de cada creador que ya habló de DUNK, una vez al día | ~500 KB por canal |
| YouTube, cada video | API interna "player" | ~6 KB (la página completa pesa 1 MB) |
| Bilibili | Búsqueda por fecha | ~30 KB |
| TikTok | Por link (`add`). Las visitas se actualizan solas | ~400 KB |
| Instagram | Por link (`add --views N`). Las visitas se ponen a mano | 0 |

Para no gastar de más:
- **Nunca revisa dos veces el mismo video.** Lo que se descarta queda anotado en `rejected`.
- **Las visitas se actualizan según la antigüedad:** en cada escaneo si el post tiene menos de 7 días, cada 3 días hasta los 30 días, y después una vez por semana.
- El primer escaneo tardó 5 minutos (37 MB). Los siguientes tardan menos de 1 minuto (~10–18 MB).

TikTok e Instagram no permiten buscar sin iniciar sesión, y los buscadores (DuckDuckGo, Bing) bloquean con CAPTCHA, así que esos posts entran por link.

### Búsqueda en TikTok e Instagram (con sesión, en el navegador de Claude)

Ahí está la mayor parte de las visitas: el 29/10 TikTok e Instagram sumaban ~300 mil, contra ~45 mil de YouTube. Con la sesión iniciada en el navegador integrado:

- **TikTok:** buscar en `tiktok.com/search/video?q=...`. Las búsquedas que más rinden son "DUNK steam", "dunkthegame", "DUNK katapult", "first person basketball game" y "DUNK jogo basquete". Cada ID de video trae su fecha de subida (`id >> 32` = segundos Unix), así que se filtran los links desde `since` y se pasan a `check` en un .txt.
- **Instagram:** buscar en `instagram.com/explore/search/keyword/?q=...` ("DUNK steam", "#dunkgame", "DUNK jogo", "DUNK juego baloncesto"). El código del post también trae su fecha. Con sesión, `/api/v1/media/<id>/info/` entrega usuario, visitas (`play_count`) y likes. Después se agrega con `add <link> --views N --likes N --title "..."`.
- `check` lee la descripción completa, porque muchos creadores nombran el juego recién al final.

## Cómo decide

- **nuevo**: menciona a Katapult, el app de Steam (4591520), #dunkthegame, squaddunk o 友尽大扣篮.
- **revisar**: dice "DUNK" en mayúsculas junto a palabras de videojuego (game, Steam, demo, co-op, juego, jogo…). Hay que mirarlo.
- **descartado**: todo lo demás, y lo que coincide con `exclude` (NBA, clavadas reales, otros juegos).
- **pagado**: la descripción dice #ad, sponsored, patrocinado, publi, etc.

Si cambias las reglas en `config.json`, corre `recheck` para volver a aplicarlas a lo que está en "revisar".

## Comandos

```
scan [--only youtube,creators,related,bilibili] [--no-refresh]
refresh [--all]
add <link> [--views N] [--likes N]
set <id> nuevo|aprobado|descartado|revisar|en-sitio
recheck
creator <@handle> [--jestr|--no-jestr] [--platform youtube|tiktok|instagram] [--tiktok @x] [--instagram @x] [--no-watch]
site
report
```

## Jestr y orgánicos

En `creators.json`, cada creador tiene `jestr: true`, `false` o `null` (sin marcar). El informe suma posts y visitas por cada grupo. Para marcarlos:

```
node tools/radar/radar.mjs creator @DuckInvaders --jestr
node tools/radar/radar.mjs creator @lofichay --no-jestr
```

Los creadores nuevos que aparecen en las búsquedas quedan sin marcar.

## Pasar al sitio

Reglas del carrusel (Matías, 29/10):
- **Nada propio:** se descartan las cuentas oficiales (`official` en `config.json`) y las re-subidas del trailer oficial.
- **Solo vertical:** un video de YouTube entra solo si abre como Short. Los horizontales quedan descartados.
- **Un video, una tarjeta:** si el mismo creador lo subió a otra red en un plazo de 3 días, la copia con menos visitas recibe `"duplicateOf": "<id de la más vista>"`. El sitio la oculta, pero suma sus visitas al total. `site` conserva ese campo al reescribir la lista.

`site` copia las visitas actualizadas a `pages/community/community.json`, ordena por visitas y lista los posts **aprobados** que todavía no están en el carrusel. Agregar un post al carrusel sigue siendo a mano, porque necesita miniatura y título corto.

## Panel del equipo

`squaddunk.com/community/panel-yhqdojqq/` (en inglés) es una tabla técnica con todos los posts: hora de subida (Irlanda, Chile o UTC), visitas sumando copias, likes, visitas por hora, pago, estado y la historia de visitas. Se ordena por cualquier columna y exporta CSV.

No está enlazada en el sitio y tiene `noindex`, pero **no tiene contraseña**: la ve cualquiera que tenga el link (GitHub Pages no permite más, y el repo es público). Cada comando del radar regenera `data.json`; las visitas más frescas las toma de `community.json`.
