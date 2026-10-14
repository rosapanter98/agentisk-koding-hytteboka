// The pages. Each is handed what it shows, and asks nothing of the book itself.

import { isEntered, sameName, Uke } from './cabin.js';
import { html } from './html.js';
import { formatMoment, formatRange, monthOf, weekNumber } from './weeks.js';

export function calendarPage({ weeks, today, name, message, typedName }) {
  const months = [];
  for (const entry of weeks) {
    const title = monthOf(entry.week);
    if (months.at(-1)?.title !== title) months.push({ title, weeks: [] });
    months.at(-1).weeks.push(entry);
  }

  return page({ title: 'Når er hytta ledig?', name }, html`
    <section class="hero">
      ${cabinArt()}
      <div class="hero-text">
        <h1>Når er hytta ledig?</h1>
        <p>Book en ledig uke. Ukene alle vil ha, trekker vi lodd om: meld deg på, så trekkes vinneren mens kontoret ser på.</p>
      </div>
    </section>

    ${alert(message)}
    ${name ? '' : nameForm(typedName)}

    <ul class="legend" aria-label="Fargene i kalenderen">
      <li class="legend--free">Ledig</li>
      <li class="legend--booked">Opptatt</li>
      <li class="legend--draw">Trekning</li>
    </ul>

    ${months.map((month) => html`
      <section class="month">
        <h2>${month.title}</h2>
        <ul class="weeks">
          ${month.weeks.map((entry) => weekCard(entry, { name, today }))}
        </ul>
      </section>
    `)}
  `);
}

function weekCard({ week, booking, draw }, { name, today }) {
  const mine = Boolean(booking && name && sameName(booking.name, name));
  const state = draw ? (booking ? 'drawn' : 'draw') : booking ? 'booked' : 'free';
  const post = (action, label, quiet = false) => html`
    <form method="post" action="/uker/${week}/${action}">
      <button class="button${quiet ? ' button--quiet' : ''}">${label}</button>
    </form>`;

  let status;
  let action = '';
  if (state === 'free') {
    status = 'Ledig';
    if (name) action = post('book', 'Book uka');
  } else if (state === 'booked') {
    status = mine ? 'Du har hytta' : html`Booket av <span class="person">${booking.name}</span>`;
    if (mine) action = post('avbestill', 'Si fra deg uka', true);
  } else if (state === 'draw') {
    const entered = Boolean(name && isEntered(draw, name));
    status = html`${countEntered(draw.entries.length)}${entered ? html`<br><strong>Du er med i trekningen</strong>` : ''}`;
    if (name) action = entered ? post('meld-av', 'Meld meg av', true) : post('meld-pa', 'Meld meg på');
  } else {
    status = mine ? 'Du vant trekningen' : html`<span class="person">${booking.name}</span> vant trekningen`;
    if (mine) action = post('avbestill', 'Si fra deg uka', true);
  }

  return html`
    <li class="week week--${state}${mine ? ' week--mine' : ''}" id="${week}">
      <p class="week-when">
        <strong>Uke ${weekNumber(week)}</strong>
        <span>${formatRange(week, { year: false })}</span>
      </p>
      ${week === today ? html`<p class="tag">Denne uka</p>` : ''}
      ${draw ? html`<p class="tag tag--draw">${draw.label ? `Trekning · ${draw.label}` : 'Trekning'}</p>` : ''}
      <p class="week-status">${status}</p>
      ${action || draw ? html`
        <div class="week-actions">
          ${action}
          ${draw ? html`<a href="/trekning/${week}">Se trekningen</a>` : ''}
        </div>` : ''}
    </li>`;
}

function nameForm(typedName) {
  return html`
    <form class="who-are-you" method="post" action="/navn">
      <label for="navn">Hvem er du?</label>
      <p>Skriv hele navnet ditt, så kan du booke og melde deg på trekninger.</p>
      <div class="field-row">
        <input id="navn" name="navn" required maxlength="60" autocomplete="name" value="${typedName ?? ''}">
        <button class="button">Det er meg</button>
      </div>
    </form>`;
}

export function drawPage({ week, draw, booking, message, over = false, name }) {
  // `over`: the week went by without a winner being drawn, so there is nothing left to do here.
  if (over) {
    return messagePage({ title: `${Uke(week)} er over`, text: 'Det ble aldri trukket noen vinner til denne uka.', name });
  }

  const names = draw.entries.map((entry) => entry.name);
  const drawn = Boolean(booking);

  return page({ title: `Trekning om ${draw.label || Uke(week)}`, stage: true, script: '/trekning.js' }, html`
    <main class="draw${drawn ? ' is-done' : ''}" data-draw>
      <p class="draw-kicker">Trekning om hytta</p>
      <h1>${draw.label || Uke(week)}</h1>
      <p class="draw-when">${draw.label ? `${Uke(week)} · ` : ''}${formatRange(week)}</p>
      ${alert(message)}

      ${names.length === 0 ? html`<p class="draw-empty">Ingen har meldt seg på ennå.</p>` : ''}
      <ol class="tickets" data-tickets>
        ${names.map((name) => html`
          <li class="ticket${drawn && sameName(name, booking.name) ? ' is-winner' : ''}" data-ticket>${name}</li>`)}
      </ol>

      <section class="winner" data-winner tabindex="-1"${drawn ? '' : html` hidden`}>
        <p class="winner-lead">Hytta går til</p>
        <p class="winner-name" data-winner-name>${booking?.name}</p>
        ${drawn ? html`<p class="winner-when">Trukket ${formatMoment(booking.at)} blant ${countEntered(names.length)}.</p>` : ''}
      </section>

      ${!drawn && names.length > 0 ? html`
        <form class="draw-form" method="post" action="/trekning/${week}/trekk" data-draw-form>
          <p class="draw-count">${names.length} lodd i hatten</p>
          <label class="ready">
            <input type="checkbox" name="klar" value="ja" required>
            Alle som skal se på, er her
          </label>
          <button class="button button--draw">Trekk vinneren</button>
        </form>` : ''}

      <p class="draw-back"><a href="/#${week}">Tilbake til hytteboka</a></p>
    </main>
  `);
}

export function managerPage({ draws, freeWeeks, name, message }) {
  return page({ title: 'For kontorsjefen', name }, html`
    <h1>For kontorsjefen</h1>
    <p class="lead">Her velger du hvilke uker det skal trekkes lodd om, og åpner trekningen når kontoret er samlet.</p>
    ${alert(message)}

    <section class="panel">
      <h2>Ukene det trekkes lodd om</h2>
      ${draws.length === 0 ? html`<p>Ingen uker ennå.</p>` : html`
        <ul class="draw-list">
          ${draws.map(drawRow)}
        </ul>`}
    </section>

    <section class="panel">
      <h2>Trekk lodd om en uke til</h2>
      <form class="fields" method="post" action="/kontorsjef/trekningsuker">
        <label for="uke">Uke</label>
        <select id="uke" name="uke" required>
          ${freeWeeks.map((week) => html`<option value="${week}">${Uke(week)} · ${formatRange(week)}</option>`)}
        </select>
        <label for="ukenavn">Hva kaller dere uka? <span class="optional">Kan stå tomt</span></label>
        <input id="ukenavn" name="navn" maxlength="40" placeholder="Høstferie">
        <button class="button">Trekk lodd om denne uka</button>
      </form>
    </section>
  `);
}

function drawRow({ week, draw, booking }) {
  const names = draw.entries.map((entry) => entry.name);
  return html`
    <li>
      <p class="draw-list-title">
        <strong>${draw.label || Uke(week)}</strong>
        <span>${draw.label ? `${Uke(week)} · ` : ''}${formatRange(week)}</span>
      </p>
      <p>${booking
        ? html`Trukket: <span class="person">${booking.name}</span> vant.`
        : names.length === 0 ? 'Ingen påmeldt ennå.' : html`${countEntered(names.length)}: <span class="person">${names.join(', ')}</span>`}</p>
      <div class="row-actions">
        <a class="button" href="/trekning/${week}">${booking ? 'Se trekningen' : 'Åpne trekningen'}</a>
        ${!booking && names.length === 0 ? html`
          <form method="post" action="/kontorsjef/trekningsuker/${week}/fjern">
            <button class="button button--quiet">Gjør om til vanlig uke</button>
          </form>` : ''}
      </div>
    </li>`;
}

export function messagePage({ title, text, name }) {
  return page({ title, name }, html`
    <h1>${title}</h1>
    <p class="lead">${text}</p>
    <p><a href="/">Til hytteboka</a></p>
  `);
}

function page({ title, name, stage = false, script }, content) {
  return html`<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title} · Hytteboka</title>
<link rel="icon" href="/hytte.svg">
<link rel="stylesheet" href="/stil.css">
${script ? html`<script type="module" src="${script}"></script>` : ''}
</head>
${stage ? html`<body class="stage">${content}</body>` : html`<body class="page">
<header class="top">
  <a class="brand" href="/">Hytteboka <span>Havbris AS</span></a>
  ${name ? html`
    <form class="who" method="post" action="/navn">
      <span>Du er <strong>${name}</strong></span>
      <button class="link">Bytt navn</button>
    </form>` : ''}
</header>
<main class="content">${content}</main>
<footer class="bottom"><a href="/">Kalenderen</a> <a href="/kontorsjef">For kontorsjefen</a></footer>
</body>`}
</html>
`.toString();
}

function alert(message) {
  return message ? html`<p class="message" role="alert">${message}</p>` : '';
}

function countEntered(count) {
  return count === 0 ? 'Ingen påmeldt ennå' : `${count} påmeldt${count === 1 ? '' : 'e'}`;
}

function cabinArt() {
  return html`
    <svg class="hero-art" viewBox="0 0 320 150" role="img" aria-label="En rød hytte under to fjell">
      <path class="art-far" d="M0 150 L70 52 L118 108 L176 24 L262 150 Z"/>
      <path class="art-snow" d="M176 24 L201 61 L186 54 L176 66 L165 53 L153 58 Z M70 52 L86 71 L73 66 L62 74 L57 70 Z"/>
      <path class="art-near" d="M150 150 L240 76 L320 132 L320 150 Z"/>
      <path class="art-tree" d="M36 150 L50 104 L64 150 Z M270 150 L282 114 L294 150 Z M292 150 L302 122 L312 150 Z"/>
      <path class="art-wall" d="M92 150 L92 116 L168 116 L168 150 Z"/>
      <path class="art-roof" d="M82 118 L130 88 L178 118 Z"/>
      <path class="art-window" d="M104 126 h16 v14 h-16 Z M140 126 h14 v24 h-14 Z"/>
    </svg>`;
}
