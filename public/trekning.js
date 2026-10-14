// The draw page in the browser. Without this script the button posts its form and the next
// page says who won. With it, the answer is fetched and shown as a show: the light hops
// between the tickets, stops on the winner, and confetti falls.

import { planHops } from './hopp.js';

const stage = document.querySelector('[data-draw]');
const form = stage?.querySelector('[data-draw-form]');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  form.querySelector('button').disabled = true;

  let drawn;
  let trouble = 'Det gikk ikke å trekke akkurat nå. Prøv igjen om litt.';
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams(new FormData(form)),
    });
    const answer = await response.json();
    if (response.ok) drawn = answer;
    else trouble = answer.message ?? trouble;
  } catch {
    // The server is away, or something other than the server answered. `trouble` stays as it is.
  }

  if (!drawn) {
    // Refused, for instance because someone else drew first: the server says why. The button is for trying again.
    const note = stage.querySelector('.message') ?? document.createElement('p');
    note.className = 'message';
    note.setAttribute('role', 'alert');
    note.textContent = trouble;
    form.prepend(note);
    form.querySelector('button').disabled = false;
    return;
  }

  // The tickets are written again from the answer, so someone who entered after this page was opened is there.
  const list = stage.querySelector('[data-tickets]');
  const tickets = drawn.entries.map((name) => {
    const ticket = document.createElement('li');
    ticket.className = 'ticket';
    ticket.textContent = name;
    return ticket;
  });
  list.replaceChildren(...tickets);
  form.remove();
  // On a small screen the button stood below the tickets, and the tickets are what to watch now.
  list.scrollIntoView({ block: 'center' });

  if (!calm) {
    stage.classList.add('is-drawing');
    let lit;
    for (const hop of planHops(tickets.length, drawn.winner)) {
      lit?.classList.remove('is-lit');
      lit = tickets[hop.index];
      lit.classList.add('is-lit');
      await rest(hop.wait);
    }
    await rest(900);
    lit.classList.remove('is-lit');
    stage.classList.remove('is-drawing');
  }

  tickets[drawn.winner].classList.add('is-winner');
  stage.classList.add('is-done');
  const winner = stage.querySelector('[data-winner]');
  winner.querySelector('[data-winner-name]').textContent = drawn.entries[drawn.winner];
  winner.hidden = false;
  winner.focus({ preventScroll: true });
  winner.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  if (!calm) confetti();
});

function rest(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function confetti() {
  const colours = ['#e8b93c', '#c8432f', '#f7f3ea', '#3f8f6b', '#7fb6e6'];
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const paint = canvas.getContext('2d');

  const fit = () => {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  };
  fit();
  addEventListener('resize', fit);

  const pieces = Array.from({ length: 220 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height,
    width: 6 + Math.random() * 8,
    height: 10 + Math.random() * 10,
    fall: 2 + Math.random() * 4,
    drift: -1.5 + Math.random() * 3,
    turn: Math.random() * Math.PI,
    spin: -0.15 + Math.random() * 0.3,
    colour: colours[Math.floor(Math.random() * colours.length)],
  }));

  const started = performance.now();
  const lasts = 9000;
  requestAnimationFrame(function frame(time) {
    const left = 1 - (time - started) / lasts;
    if (left <= 0) {
      removeEventListener('resize', fit);
      canvas.remove();
      return;
    }
    paint.clearRect(0, 0, canvas.width, canvas.height);
    paint.globalAlpha = Math.min(1, left * 4);
    for (const piece of pieces) {
      piece.x += piece.drift;
      piece.y += piece.fall;
      piece.turn += piece.spin;
      if (piece.y > canvas.height + 20) piece.y = -20;
      paint.save();
      paint.translate(piece.x, piece.y);
      paint.rotate(piece.turn);
      paint.fillStyle = piece.colour;
      paint.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height * Math.abs(Math.cos(piece.turn)));
      paint.restore();
    }
    requestAnimationFrame(frame);
  });
}
