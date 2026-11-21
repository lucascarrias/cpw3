#!/usr/bin/env node
/**
 * Extracts the Campus Party Piauí #3 schedule from the 4.events public API
 * and writes a normalized snapshot to public/schedule.json.
 *
 * The API is the one used by
 *   https://app.4.events/c/SlN3elFGUXRJeXhnQ21BSw==/108/programacao-evento.html
 * (client 18443, event 108).
 *
 * Usage: node scripts/extract.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = 'https://api.4.events/activities/schedule/18443/108/v2';
const TIME_ZONE = 'America/Fortaleza';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = resolve(ROOT, 'public/schedule.json');

/** Format a unix timestamp (seconds) as an ISO string with the Fortaleza offset. */
function toIso(seconds) {
  const date = new Date(Number(seconds) * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const localAsUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  );
  const offsetMinutes = Math.round((localAsUtc - date.getTime()) / 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

/** ISO calendar date (YYYY-MM-DD) in Fortaleza for a unix timestamp. */
function localDate(seconds) {
  return toIso(seconds).slice(0, 10);
}

/** Very small HTML-to-text conversion, enough for descriptions coming from the API. */
function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchSchedule() {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'cpw-piaui-schedule/1.0 (static schedule snapshot)',
  };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(API_URL, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const payload = await response.json();
      if (payload?.status !== 200 || !payload.result?.schedule) {
        throw new Error('Unexpected API payload shape');
      }
      return payload.result;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw new Error(`Could not fetch schedule: ${lastError?.message ?? lastError}`);
}

function normalize(result) {
  const speakers = new Map();
  const sessions = [];
  const categoryOrder = [];

  for (const group of result.schedule ?? []) {
    for (const activity of group.activity_list ?? []) {
      const speakerIds = [];
      for (const speaker of activity.speakers ?? []) {
        const id = String(speaker.id);
        speakerIds.push(id);
        if (!speakers.has(id)) {
          speakers.set(id, {
            id,
            name: speaker.name || 'Palestrante',
            bio: htmlToText(speaker.description),
            photo: speaker.foto || '',
            role: speaker.profession || speaker.tipo_name || '',
          });
        }
      }

      const categories = (activity.tags ?? [])
        .map((tag) => String(tag.text || '').trim())
        .filter(Boolean);
      for (const category of categories) {
        if (!categoryOrder.includes(category)) categoryOrder.push(category);
      }

      sessions.push({
        id: String(activity.id),
        title: activity.name || 'Atividade',
        desc: htmlToText(activity.description),
        start: toIso(activity.start_time),
        end: toIso(activity.end_time),
        room: activity.auditorium_name || '',
        category: categories[0] ?? '',
        categories,
        speakerIds,
      });
    }
  }

  sessions.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

  const days = [...new Set(sessions.map((s) => s.start.slice(0, 10)))].sort();
  const labelFor = new Map(
    (result.schedule ?? []).map((group) => [localDate(group.day_timestamp), group.name]),
  );

  return {
    meta: {
      event: 'Campus Party Piauí #3',
      source: API_URL,
      sourcePage:
        'https://app.4.events/c/SlN3elFGUXRJeXhnQ21BSw==/108/programacao-evento.html',
      timeZone: TIME_ZONE,
      generatedAt: new Date().toISOString(),
      days: days.map((date) => ({ date, label: labelFor.get(date) ?? date })),
      categories: categoryOrder,
      sessionCount: sessions.length,
      speakerCount: speakers.size,
    },
    sessions,
    speakers: [...speakers.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  };
}

const result = await fetchSchedule();
const data = normalize(result);

await mkdir(dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

console.log(
  `Wrote ${data.meta.sessionCount} sessions and ${data.meta.speakerCount} speakers to public/schedule.json`,
);
console.log(`Days: ${data.meta.days.map((d) => d.label).join(', ')}`);
console.log(`Categories: ${data.meta.categories.join(' | ')}`);
