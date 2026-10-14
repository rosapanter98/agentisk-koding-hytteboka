// The server as people meet it: every request here goes over HTTP to a server on a port of its own,
// with a book in a folder of its own. The day is Wednesday 14 October 2026, in week 42.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { firstState } from '../src/cabin.js';
import { openStore } from '../src/store.js';

const NOW = new Date('2026-10-14T10:00:00Z');
const AUTUMN = '2026-W45';
const EASTER = '2027-W12';

let server;
let origin;
let file;

before(() => {
  server = createServer((request, response) => server.app(request, response));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

// Every test opens a new book, in a folder that is removed at the end.
const folders = [];
beforeEach(() => {
  folders.push(mkdtempSync(join(tmpdir(), 'hytteboka-')));
  file = join(folders.at(-1), 'bok.json');
  server.app = createApp({ store: openStore(file, () => firstState(NOW)), now: () => NOW });
});

after(() => {
  folders.forEach((folder) => rmSync(folder, { recursive: true, force: true }));
  return new Promise((resolve) => server.close(resolve));
});

/** One person's browser: it sends the name they typed with everything it asks for. */
function person(name) {
  const headers = name ? { Cookie: `navn=${encodeURIComponent(name)}` } : {};
  return {
    get: (path) => fetch(origin + path, { headers, redirect: 'manual' }),
    post: (path, form = {}, more = {}) =>
      fetch(origin + path, {
        method: 'POST',
        headers: { ...headers, ...more },
        body: new URLSearchParams(form),
        redirect: 'manual',
      }),
  };
}

const ola = person('Ola Nordmann');
const kari = person('Kari Hansen');
const per = person('Per Olsen');
const visitor = person('');
const book = () => JSON.parse(readFileSync(file, 'utf8'));

/** The card of one week on the calendar, as text without tags. */
async function card(who, week) {
  const page = await (await who.get('/')).text();
  const found = new RegExp(`<li class="week[^>]*id="${week}">([\\s\\S]*?)</li>`).exec(page);
  assert.ok(found, `no card for ${week}`);
  return found[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('the calendar', () => {
  test('shows the 52 weeks from this one, with Easter and the winter break set up for a draw', async () => {
    const response = await visitor.get('/');
    const page = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(page.match(/<li class="week /g).length, 52);
    assert.match(page, /<h2>Oktober 2026<\/h2>/);
    assert.match(await card(visitor, '2026-W42'), /^Uke 42 12\.–18\. oktober Denne uka Ledig$/);
    assert.match(await card(visitor, EASTER), /Uke 12 22\.–28\. mars Trekning · Påske Ingen påmeldt ennå Se trekningen/);
    assert.match(await card(visitor, '2027-W08'), /Trekning · Vinterferie/);
  });

  test('asks who you are, and offers no buttons until it knows', async () => {
    const page = await (await visitor.get('/')).text();
    assert.match(page, /Hvem er du\?/);
    assert.doesNotMatch(page, /Book uka/);
    assert.match(await (await ola.get('/')).text(), /Book uka/);
  });

  test('remembers the name someone types, and forgets it when they ask', async () => {
    const typed = await visitor.post('/navn', { navn: '  Ola   Nordmann ' });
    assert.equal(typed.status, 303);
    assert.equal(typed.headers.get('location'), '/');
    assert.match(typed.headers.get('set-cookie'), /^navn=Ola%20Nordmann; Path=\/; Max-Age=31536000/);

    const page = await (await ola.get('/')).text();
    assert.match(page, /Du er <strong>Ola Nordmann<\/strong>/);
    assert.doesNotMatch(page, /Hvem er du\?/);

    const forgotten = await ola.post('/navn');
    assert.equal(forgotten.status, 303);
    assert.match(forgotten.headers.get('set-cookie'), /^navn=; Path=\/; Max-Age=0/);
  });

  test('a name with no letter or digit in it is no name, so it is forgotten', async () => {
    for (const navn of ['\u200B\u2800', '́', '. - .']) {
      const response = await ola.post('/navn', { navn });
      assert.equal(response.status, 303);
      assert.match(response.headers.get('set-cookie'), /^navn=; Path=\/; Max-Age=0/);
    }
  });

  test('turns away a name that is too long, and keeps what was typed', async () => {
    const response = await visitor.post('/navn', { navn: 'x'.repeat(61) });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
    const page = await response.text();
    assert.match(page, /Navnet kan være på 60 tegn/);
    assert.match(page, new RegExp(`value="${'x'.repeat(61)}"`));
  });
});

describe('booking', () => {
  test('Ola books a free week, and everyone sees that it is his', async () => {
    const response = await ola.post(`/uker/${AUTUMN}/book`);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/#${AUTUMN}`);

    assert.equal(await card(ola, AUTUMN), 'Uke 45 2.–8. november Du har hytta Si fra deg uka');
    assert.equal(await card(kari, AUTUMN), 'Uke 45 2.–8. november Booket av Ola Nordmann');
    assert.equal(await card(visitor, AUTUMN), 'Uke 45 2.–8. november Booket av Ola Nordmann');
    assert.equal(book().bookings[AUTUMN].name, 'Ola Nordmann');
  });

  test('Kari cannot book the week Ola has', async () => {
    await ola.post(`/uker/${AUTUMN}/book`);
    const response = await kari.post(`/uker/${AUTUMN}/book`);

    assert.equal(response.status, 409);
    assert.match(await response.text(), /role="alert">Uke 45 er allerede booket av Ola Nordmann\./);
    assert.equal(book().bookings[AUTUMN].name, 'Ola Nordmann');
  });

  test('when two press at the same moment, one gets the week and the other is told who did', async () => {
    const answers = await Promise.all([ola.post(`/uker/${AUTUMN}/book`), kari.post(`/uker/${AUTUMN}/book`)]);
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [303, 409]);
    assert.equal(Object.keys(book().bookings).length, 1);
  });

  test('Ola gives the week up, and then Kari can have it', async () => {
    await ola.post(`/uker/${AUTUMN}/book`);
    assert.equal((await kari.post(`/uker/${AUTUMN}/avbestill`)).status, 403);
    assert.equal((await ola.post(`/uker/${AUTUMN}/avbestill`)).status, 303);
    assert.match(await card(kari, AUTUMN), /Ledig Book uka$/);
    assert.equal((await kari.post(`/uker/${AUTUMN}/book`)).status, 303);
  });

  test('nobody books without a name, a week that is over, or a week that does not exist', async () => {
    const nameless = await visitor.post(`/uker/${AUTUMN}/book`);
    assert.equal(nameless.status, 400);
    assert.match(await nameless.text(), /Skriv navnet ditt først/);

    assert.equal((await ola.post('/uker/2026-W41/book')).status, 409);
    assert.equal((await ola.post('/uker/2027-W53/book')).status, 404);
    assert.equal((await ola.post('/uker/2026-W45/stjel')).status, 404);
    assert.deepEqual(book().bookings, {});
  });

  test('a week a winner is drawn for cannot be booked', async () => {
    const response = await ola.post(`/uker/${EASTER}/book`);
    assert.equal(response.status, 409);
    assert.match(await response.text(), /Det trekkes lodd om uke 12\. Meld deg på trekningen i stedet\./);
  });
});

describe('the draw', () => {
  const enterAll = async () => {
    for (const who of [ola, kari, per]) {
      assert.equal((await who.post(`/uker/${EASTER}/meld-pa`)).status, 303);
    }
  };
  const draw = (form = { klar: 'ja' }, headers = { Accept: 'application/json' }) =>
    visitor.post(`/trekning/${EASTER}/trekk`, form, headers);

  test('those who want Easter enter, and can leave again', async () => {
    await enterAll();
    assert.match(await card(ola, EASTER), /3 påmeldte Du er med i trekningen Meld meg av Se trekningen$/);
    assert.match(await card(person('Nina Berg'), EASTER), /3 påmeldte Meld meg på Se trekningen$/);

    assert.equal((await ola.post(`/uker/${EASTER}/meld-pa`)).status, 409);
    assert.equal((await ola.post(`/uker/${EASTER}/meld-av`)).status, 303);
    assert.match(await card(ola, EASTER), /2 påmeldte Meld meg på/);
  });

  test('the draw page shows a ticket for each, and the button', async () => {
    await enterAll();
    const response = await visitor.get(`/trekning/${EASTER}`);
    const page = await response.text();

    assert.equal(response.status, 200);
    assert.match(page, /<h1>Påske<\/h1>/);
    assert.match(page, /Uke 12 · 22\.–28\. mars 2027/);
    assert.deepEqual(
      [...page.matchAll(/<li class="ticket" data-ticket>([^<]*)<\/li>/g)].map((found) => found[1]),
      ['Ola Nordmann', 'Kari Hansen', 'Per Olsen'],
    );
    assert.match(page, /3 lodd i hatten/);
    assert.match(page, /Trekk vinneren/);
    assert.match(page, /<section class="winner" data-winner tabindex="-1" hidden>/);
    assert.match(page, /<script type="module" src="\/trekning\.js">/);
  });

  test('the winner is one of those who entered, gets the week, and is drawn once', async () => {
    await enterAll();
    const response = await draw();
    const drawn = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(drawn.entries, ['Ola Nordmann', 'Kari Hansen', 'Per Olsen']);
    assert.ok([0, 1, 2].includes(drawn.winner));
    const winner = drawn.entries[drawn.winner];
    assert.equal(book().bookings[EASTER].name, winner);

    assert.match(await card(visitor, EASTER), new RegExp(`${winner} vant trekningen Se trekningen$`));
    assert.match(await card(person(winner), EASTER), /Du vant trekningen Si fra deg uka Se trekningen$/);

    const page = await (await visitor.get(`/trekning/${EASTER}`)).text();
    assert.match(page, new RegExp(`<p class="winner-name" data-winner-name>${winner}</p>`));
    assert.match(page, /Trukket 14\. oktober 2026 kl\. 12[:.]00 blant 3 påmeldte\./);
    assert.match(page, new RegExp(`<li class="ticket is-winner" data-ticket>${winner}</li>`));
    assert.doesNotMatch(page, /Trekk vinneren/);

    const again = await draw();
    assert.equal(again.status, 409);
    assert.match((await again.json()).message, new RegExp(`Trekningen om uke 12 er gjort\\. Uka gikk til ${winner}\\.`));
    assert.equal(book().bookings[EASTER].name, winner);
    assert.equal((await person('Nina Berg').post(`/uker/${EASTER}/meld-pa`)).status, 409);
  });

  test('without scripts the button leads to the page that names the winner', async () => {
    await enterAll();
    const response = await draw({ klar: 'ja' }, {});
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/trekning/${EASTER}`);
    const page = await (await visitor.get(`/trekning/${EASTER}`)).text();
    assert.match(page, new RegExp(`data-winner-name>${book().bookings[EASTER].name}<`));
  });

  test('nothing is drawn until the box is ticked, or before someone has entered', async () => {
    assert.equal((await draw()).status, 409);

    await enterAll();
    const unticked = await draw({}, {});
    assert.equal(unticked.status, 400);
    assert.match(await unticked.text(), /Kryss av for at alle som skal se på, er her\./);
    assert.equal((await draw({})).status, 400);
    assert.deepEqual(book().bookings, {});
  });

  test('a winner who gives the week up opens the draw again for the others', async () => {
    await enterAll();
    const first = await (await draw()).json();
    const winner = first.entries[first.winner];

    assert.equal((await person(winner).post(`/uker/${EASTER}/avbestill`)).status, 303);
    const second = await (await draw()).json();

    assert.equal(second.entries.length, 2);
    assert.ok(!second.entries.includes(winner));
  });

  test('there is no draw page for an ordinary week, or for no week', async () => {
    assert.equal((await visitor.get(`/trekning/${AUTUMN}`)).status, 404);
    assert.equal((await visitor.get('/trekning/tull')).status, 404);
    assert.equal((await visitor.post(`/trekning/${AUTUMN}/trekk`, { klar: 'ja' })).status, 404);
  });
});

describe('for the office manager', () => {
  test('lists the draws, with who has entered', async () => {
    await ola.post(`/uker/${EASTER}/meld-pa`);
    await kari.post(`/uker/${EASTER}/meld-pa`);
    const page = await (await visitor.get('/kontorsjef')).text();

    assert.match(page, /<strong>Påske<\/strong>\s*<span>Uke 12 · 22\.–28\. mars 2027<\/span>/);
    assert.match(page, /2 påmeldte: <span class="person">Ola Nordmann, Kari Hansen<\/span>/);
    assert.match(page, new RegExp(`href="/trekning/${EASTER}">Åpne trekningen`));
    assert.match(page, /<option value="2026-W45">Uke 45 · 2\.–8\. november 2026<\/option>/);
    assert.doesNotMatch(page, /<option value="2027-W12">/, 'a week that is set up is not offered again');
  });

  test('sets a week up for a draw, and makes it an ordinary week again while nobody has entered', async () => {
    const made = await visitor.post('/kontorsjef/trekningsuker', { uke: AUTUMN, navn: 'Høstferie' });
    assert.equal(made.status, 303);
    assert.equal(made.headers.get('location'), '/kontorsjef');
    assert.match(await card(ola, AUTUMN), /Trekning · Høstferie Ingen påmeldt ennå Meld meg på/);
    assert.equal((await ola.post(`/uker/${AUTUMN}/book`)).status, 409);

    assert.equal((await visitor.post(`/kontorsjef/trekningsuker/${AUTUMN}/fjern`)).status, 303);
    assert.match(await card(ola, AUTUMN), /Ledig Book uka$/);
  });

  test('says why a week cannot be set up, or cannot be made ordinary', async () => {
    await ola.post(`/uker/${AUTUMN}/book`);
    const booked = await visitor.post('/kontorsjef/trekningsuker', { uke: AUTUMN });
    assert.equal(booked.status, 409);
    assert.match(await booked.text(), /role="alert">Uke 45 er allerede booket av Ola Nordmann/);

    await kari.post(`/uker/${EASTER}/meld-pa`);
    const entered = await visitor.post(`/kontorsjef/trekningsuker/${EASTER}/fjern`);
    assert.equal(entered.status, 409);
    assert.match(await entered.text(), /1 har meldt seg på trekningen om uke 12/);

    assert.equal((await visitor.post('/kontorsjef/trekningsuker', {})).status, 404);
  });
});

describe('what the server is careful about', () => {
  test('a name is shown as it was typed, never read as markup', async () => {
    const rascal = person('<img src=x onerror=alert(1)>');
    await rascal.post(`/uker/${AUTUMN}/book`);
    await rascal.post(`/uker/${EASTER}/meld-pa`);

    for (const path of ['/', '/kontorsjef', `/trekning/${EASTER}`]) {
      const page = await (await kari.get(path)).text();
      assert.doesNotMatch(page, /<img/, path);
      assert.match(page, /&lt;img src=x onerror=alert\(1\)&gt;/, path);
    }
  });

  test('pages may load their own files and nothing else', async () => {
    const response = await visitor.get('/');
    assert.match(response.headers.get('content-security-policy'), /^default-src 'self';/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  test('a form that another site made the browser send is turned away', async () => {
    const response = await ola.post(`/uker/${AUTUMN}/book`, {}, { 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(response.status, 403);
    assert.deepEqual(book().bookings, {});
    assert.equal((await ola.post(`/uker/${AUTUMN}/book`, {}, { 'Sec-Fetch-Site': 'same-origin' })).status, 303);
  });

  test('a form far bigger than any form here is turned away', async () => {
    const response = await ola.post('/navn', { navn: 'x'.repeat(20_000) });
    assert.equal(response.status, 413);
  });

  test('serves its style, scripts and icon, and says so when a page is not there', async () => {
    for (const [path, type] of [
      ['/stil.css', /text\/css/],
      ['/trekning.js', /text\/javascript/],
      ['/hopp.js', /text\/javascript/],
      ['/hytte.svg', /image\/svg\+xml/],
    ]) {
      const response = await visitor.get(path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), type);
      assert.ok((await response.text()).length > 100);
    }

    const missing = await visitor.get('/server.js');
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Den siden finnes ikke/);
    assert.equal((await visitor.get('/../package.json')).status, 404);
  });
});
