// What the server answers. `createApp` gives the function `node:http` calls for each request.
//
// There is no login: who someone is, is the name they typed, kept in the cookie `navn`.
// A change is a posted form. One that went well is answered by sending the browser to the page
// that shows it; one that was refused, by that page again with why.

import { readFile } from 'node:fs/promises';
import {
  book, calendar, cancel, describe, drawWinner, enter, isBlank, markDraw, readName, unmarkDraw, withdraw,
} from './cabin.js';
import { calendarPage, drawPage, managerPage, messagePage } from './pages.js';
import { currentWeek, isWeekId } from './weeks.js';

const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

const FILES = {
  '/stil.css': 'text/css; charset=utf-8',
  '/trekning.js': 'text/javascript; charset=utf-8',
  '/hopp.js': 'text/javascript; charset=utf-8',
  '/hytte.svg': 'image/svg+xml',
};

const WEEK_RULES = { book, avbestill: cancel, 'meld-pa': enter, 'meld-av': withdraw };

// The pages load their own files and nothing else, and run no script written into a page.
const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
};

const FORM_LIMIT = 10_000;

export function createApp({ store, now = () => new Date() }) {
  const today = () => currentWeek(now());

  async function answer(request, response) {
    const { pathname } = new URL(request.url, 'http://hytteboka');
    const name = nameOf(request);
    let match;

    const send = (status, body, type = HTML, more = {}) => {
      response.writeHead(status, { ...HEADERS, 'Content-Type': type, ...more });
      response.end(body);
    };
    const goTo = (address, more = {}) => {
      response.writeHead(303, { ...HEADERS, Location: address, ...more });
      response.end();
    };
    const notFound = () =>
      send(404, messagePage({ title: 'Den siden finnes ikke', text: 'Kanskje adressen er skrevet feil.', name }));

    const showCalendar = (status = 200, more = {}) =>
      send(status, calendarPage({ weeks: calendar(store.state, today()), today: today(), name, ...more }));

    const showManager = (status = 200, message) => {
      const weeks = calendar(store.state, today());
      send(status, managerPage({
        draws: weeks.filter((entry) => entry.draw),
        freeWeeks: weeks.filter((entry) => !entry.draw && !entry.booking).map((entry) => entry.week),
        name,
        message,
      }));
    };

    const showDraw = (week, status = 200, message) => {
      const entry = isWeekId(week) ? describe(store.state, week) : null;
      if (!entry?.draw) return notFound();
      send(status, drawPage({ ...entry, message }));
    };

    if (request.method === 'GET') {
      if (pathname === '/') return showCalendar();
      if (pathname === '/kontorsjef') return showManager();
      if ((match = /^\/trekning\/([^/]+)$/.exec(pathname))) return showDraw(match[1]);
      if (FILES[pathname]) {
        const file = await readFile(new URL(`../public${pathname}`, import.meta.url));
        return send(200, file, FILES[pathname], { 'Cache-Control': 'no-cache' });
      }
      return notFound();
    }

    if (request.method !== 'POST') return notFound();

    // A browser says where a posted form came from. One that another site made it send is turned away.
    const from = request.headers['sec-fetch-site'];
    if (from && from !== 'same-origin' && from !== 'none') {
      return send(403, messagePage({ title: 'Det gikk ikke', text: 'Skjemaet kom ikke fra hytteboka.', name }));
    }

    const form = await readForm(request);
    if (!form) return send(413, messagePage({ title: 'Det gikk ikke', text: 'Skjemaet var for stort.', name }));
    const wish = { today: today(), now: now().toISOString() };

    if (pathname === '/navn') {
      const typed = form.get('navn') ?? '';
      const forget = 'navn=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
      if (isBlank(typed)) return goTo('/', { 'Set-Cookie': forget });
      const newName = readName(typed);
      if (!newName) return showCalendar(400, { message: 'Navnet kan være på 60 tegn.', typedName: typed });
      const remember = `navn=${encodeURIComponent(newName)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;
      return goTo('/', { 'Set-Cookie': remember });
    }

    if ((match = /^\/uker\/([^/]+)\/(book|avbestill|meld-pa|meld-av)$/.exec(pathname))) {
      const [, week, action] = match;
      const result = store.change(WEEK_RULES[action], { ...wish, week, name });
      return result.ok ? goTo(`/#${week}`) : showCalendar(result.status, { message: result.message });
    }

    if ((match = /^\/trekning\/([^/]+)\/trekk$/.exec(pathname))) {
      const week = match[1];
      const result = form.get('klar') === 'ja'
        ? store.change(drawWinner, { ...wish, week })
        : { ok: false, status: 400, message: 'Kryss av for at alle som skal se på, er her.' };

      // The draw page's script asks for the answer as data, to show it its own way.
      if (request.headers.accept?.includes('application/json')) {
        const body = result.ok ? { winner: result.winner, entries: result.entries } : { message: result.message };
        return send(result.ok ? 200 : result.status, JSON.stringify(body), JSON_TYPE);
      }
      return result.ok ? goTo(`/trekning/${week}`) : showDraw(week, result.status, result.message);
    }

    if (pathname === '/kontorsjef/trekningsuker') {
      const result = store.change(markDraw, { ...wish, week: form.get('uke') ?? '', label: form.get('navn') ?? '' });
      return result.ok ? goTo('/kontorsjef') : showManager(result.status, result.message);
    }

    if ((match = /^\/kontorsjef\/trekningsuker\/([^/]+)\/fjern$/.exec(pathname))) {
      const result = store.change(unmarkDraw, { ...wish, week: match[1] });
      return result.ok ? goTo('/kontorsjef') : showManager(result.status, result.message);
    }

    return notFound();
  }

  return (request, response) =>
    answer(request, response).catch((error) => {
      console.error(error);
      if (response.headersSent) return response.end();
      response.writeHead(500, { ...HEADERS, 'Content-Type': HTML });
      response.end(messagePage({ title: 'Noe gikk galt', text: 'Det er vår feil, ikke din. Prøv igjen om litt.' }));
    });
}

function nameOf(request) {
  const match = /(?:^|;\s*)navn=([^;]*)/.exec(request.headers.cookie ?? '');
  if (!match) return '';
  try {
    return readName(decodeURIComponent(match[1]));
  } catch {
    return '';
  }
}

/** The fields of a posted form, or null when more was sent than a form here ever holds. */
async function readForm(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > FORM_LIMIT) return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
