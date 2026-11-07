// Convierte la planilla de feedback (CSV) en un archivo SQL para cargar en D1.
// Uso:
//   node scripts/import-sheet.mjs planilla.csv > import.sql
//   npx wrangler d1 execute dunk-feedback --remote --file import.sql
//
// Columnas conocidas (no importa mayúsculas): Date, Player, Origin, Feedback, Build, Location, Submission ID.
// Cualquier otra columna se toma como una pregunta del formulario (encabezado = pregunta).
// Si después el mismo envío llega por Discord, la versión de Discord reemplaza a la de la planilla.

import { readFileSync } from 'node:fs';
import { guessCategory, guessSystems, isJunk } from '../src/parse.js';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const sql = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

function toIso(v) {
  if (!v) return new Date().toISOString();
  // dd/mm/yyyy [hh:mm] (formato de planillas en español)
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]), Number(m[4] || 12), Number(m[5] || 0))).toISOString();
  }
  const d = new Date(v);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/import-sheet.mjs planilla.csv > import.sql');
  process.exit(1);
}
const [header, ...rows] = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const norm = header.map((h) => h.trim().toLowerCase());
const col = (name) => norm.indexOf(name);
const KNOWN = { date: col('date'), player: col('player'), origin: col('origin'), feedback: col('feedback'), build: col('build'), location: col('location'), submission: col('submission id') };
const questionCols = header.map((h, i) => i).filter((i) => !Object.values(KNOWN).includes(i) && header[i].trim() && !/^date\b|source link/i.test(header[i].trim()));

let out = '';
let n = 0;
for (const r of rows) {
  const get = (i) => (i >= 0 ? (r[i] || '').trim() : '');
  const submission = get(KNOWN.submission) || null;
  const fields = [];
  if (get(KNOWN.feedback)) fields.push({ q: 'Feedback', a: get(KNOWN.feedback) });
  for (const i of questionCols) if (get(i)) fields.push({ q: header[i].trim(), a: get(i) });
  if (!fields.length) continue;
  const likedField = fields.find((f) => /enjoy|like|fun|best/i.test(f.q));
  const liked = likedField && !/^(nothing|none|n\/?a|no|-|\.)$/i.test(likedField.a) ? likedField.a : null;
  const problem = fields.filter((f) => f !== likedField).map((f) => f.a).join(' ');
  const content = fields.map((f) => `${f.q}\n${f.a}`).join('\n\n');
  const id = `sheet:${submission || `row${++n}`}`;
  const player = get(KNOWN.player);
  out += `INSERT INTO items (id, source, channel_id, url, author_name, content, fields, attachments, forum_tags, build, context, mode, submission_id, created_at, auto_category, systems, liked)
SELECT ${sql(id)}, 'game', 'sheet', '', ${sql(player && !/^anonymous$/i.test(player) ? player : 'Player (in-game)')}, ${sql(content)}, ${sql(JSON.stringify(fields))}, '[]', '[]',
  ${sql(get(KNOWN.build).replace(/^v/i, ''))}, ${sql(get(KNOWN.origin))}, ${sql(get(KNOWN.location))}, ${sql(submission)}, ${sql(toIso(get(KNOWN.date)))},
  ${sql(isJunk(fields.map((f) => f.a)) ? 'spam' : guessCategory(problem))}, ${sql(JSON.stringify(guessSystems(problem)))}, ${sql(liked)}
WHERE NOT EXISTS (SELECT 1 FROM items WHERE id = ${sql(id)}${submission ? ` OR submission_id = ${sql(submission)}` : ''});
`;
}
process.stdout.write(out);
console.error(`${out.split('INSERT').length - 1} filas listas para importar.`);
