// The rules of the cabin book.
//
// Everything that is stored is one object:
//
//   bookings: { [week]: { name, at } }                       who has the cabin that week
//   draws:    { [week]: { label, entries: [{ name, at }] } } the weeks a winner is drawn for
//
// A week has at most one booking, since bookings are kept by week.
// A draw is done when its week has a booking: that booking is the winner, and its `at` is when it was drawn.
//
// Each rule takes the state and what someone wants, and either changes the state and answers
// { ok: true }, or leaves it as it was and answers { ok: false, status, message } with words for the person.

import { randomInt } from 'node:crypto';
import { addWeeks, currentWeek, easterSunday, isWeekId, weekIdOf, weekNumber, weeksFrom } from './weeks.js';

/** How many weeks are shown and can be booked, counting the one we are in. */
export const HORIZON = 52;

const NAME_LENGTH = 60;
const LABEL_LENGTH = 40;

export function emptyState() {
  return { bookings: {}, draws: {} };
}

/** What the book holds the first time it is opened: the weeks Gro named, set up for a draw. */
export function firstState(now = new Date()) {
  const state = emptyState();
  const today = currentWeek(now);
  const year = Number(today.slice(0, 4));
  const next = (weekIn) => [weekIn(year), weekIn(year + 1)].find((week) => isOpen(week, today));

  const winterBreak = next((y) => `${y}-W08`);
  const easter = next((y) => weekIdOf(easterSunday(y)));
  if (winterBreak) state.draws[winterBreak] = { label: 'Vinterferie', entries: [] };
  if (easter) state.draws[easter] = { label: 'Påske', entries: [] };
  return state;
}

/** A name as someone typed it, tidied. Empty when it cannot be used as a name. */
export function readName(text) {
  const name = tidy(text);
  return name.length <= NAME_LENGTH && !isBlank(name) ? name : '';
}

/** Whether a text has nothing to be called by: no letter or digit once it is tidied. */
export function isBlank(text) {
  return !/[\p{L}\p{N}]/u.test(tidy(text));
}

export function sameName(a, b) {
  return tidy(a).toLocaleLowerCase('nb') === tidy(b).toLocaleLowerCase('nb');
}

export function isEntered(draw, name) {
  return draw.entries.some((entry) => sameName(entry.name, name));
}

/** The weeks from this one on, each with what stands in the book about it. */
export function calendar(state, today) {
  return weeksFrom(today, HORIZON).map((week) => describe(state, week));
}

export function describe(state, week) {
  return { week, booking: state.bookings[week] ?? null, draw: state.draws[week] ?? null };
}

export function book(state, { week, name, today, now }) {
  const problem = weekProblem(week, today) ?? nameProblem(name);
  if (problem) return problem;

  const booking = state.bookings[week];
  if (state.draws[week]) {
    return booking
      ? refuse(`Det er trukket lodd om ${uke(week)}, og den gikk til ${booking.name}.`)
      : refuse(`Det trekkes lodd om ${uke(week)}. Meld deg på trekningen i stedet.`);
  }
  if (booking) {
    return sameName(booking.name, name)
      ? refuse(`Du har allerede ${uke(week)}.`)
      : refuse(`${Uke(week)} er allerede booket av ${booking.name}.`);
  }

  state.bookings[week] = { name: readName(name), at: now };
  return done();
}

/** Giving a week up. A week that was won in a draw goes back to be drawn among the others. */
export function cancel(state, { week, name, today }) {
  const problem = weekProblem(week, today) ?? nameProblem(name);
  if (problem) return problem;

  const booking = state.bookings[week];
  if (!booking) return refuse(`${Uke(week)} er ikke booket.`);
  if (!sameName(booking.name, name)) return refuse(`${Uke(week)} er booket av ${booking.name}, ikke av deg.`, 403);

  delete state.bookings[week];
  const draw = state.draws[week];
  if (draw) draw.entries = draw.entries.filter((entry) => !sameName(entry.name, name));
  return done();
}

export function enter(state, { week, name, today, now }) {
  const problem = weekProblem(week, today) ?? nameProblem(name) ?? drawProblem(state, week);
  if (problem) return problem;

  const draw = state.draws[week];
  if (isEntered(draw, name)) return refuse(`Du er allerede påmeldt trekningen om ${uke(week)}.`);

  draw.entries.push({ name: readName(name), at: now });
  return done();
}

export function withdraw(state, { week, name, today }) {
  const problem = weekProblem(week, today) ?? nameProblem(name) ?? drawProblem(state, week);
  if (problem) return problem;

  const draw = state.draws[week];
  if (!isEntered(draw, name)) return refuse(`Du er ikke påmeldt trekningen om ${uke(week)}.`);

  draw.entries = draw.entries.filter((entry) => !sameName(entry.name, name));
  return done();
}

/**
 * Draws the winner: one of those entered, each with the same chance, and books the week for them.
 * `pick(count)` answers a whole number from 0 up to, not including, count.
 */
export function drawWinner(state, { week, today, now, pick = randomInt }) {
  const problem = weekProblem(week, today) ?? drawProblem(state, week);
  if (problem) return problem;

  const { entries } = state.draws[week];
  if (entries.length === 0) return refuse(`Ingen har meldt seg på trekningen om ${uke(week)} ennå.`);

  const winner = pick(entries.length);
  state.bookings[week] = { name: entries[winner].name, at: now };
  return done({ winner, entries: entries.map((entry) => entry.name) });
}

export function markDraw(state, { week, label, today }) {
  const problem = weekProblem(week, today);
  if (problem) return problem;

  const title = tidy(label);
  if (title.length > LABEL_LENGTH) return refuse(`Navnet på uka kan være på ${LABEL_LENGTH} tegn.`, 400);
  if (state.draws[week]) return refuse(`Det trekkes allerede lodd om ${uke(week)}.`);
  const booking = state.bookings[week];
  if (booking) return refuse(`${Uke(week)} er allerede booket av ${booking.name}, så den kan det ikke trekkes lodd om.`);

  state.draws[week] = { label: title, entries: [] };
  return done();
}

export function unmarkDraw(state, { week, today }) {
  const problem = weekProblem(week, today) ?? drawProblem(state, week);
  if (problem) return problem;

  const count = state.draws[week].entries.length;
  if (count > 0) {
    return refuse(`${count} har meldt seg på trekningen om ${uke(week)}, så den kan ikke gjøres om til en vanlig uke.`);
  }

  delete state.draws[week];
  return done();
}

export function uke(week) {
  return `uke ${weekNumber(week)}`;
}

export function Uke(week) {
  return `Uke ${weekNumber(week)}`;
}

function isOpen(week, today) {
  return isWeekId(week) && week >= today && week < addWeeks(today, HORIZON);
}

function weekProblem(week, today) {
  if (!isWeekId(week)) return refuse('Den uka finnes ikke.', 404);
  if (week < today) return refuse(`${Uke(week)} er over.`);
  if (!isOpen(week, today)) return refuse(`${Uke(week)} er for langt fram til å stå i boka ennå.`);
  return null;
}

function nameProblem(name) {
  return readName(name) ? null : refuse('Skriv navnet ditt først.', 400);
}

/** Why nobody can enter, leave or draw: there is no draw for the week, or it is done. */
function drawProblem(state, week) {
  if (!state.draws[week]) return refuse(`Det trekkes ikke lodd om ${uke(week)}.`);
  const booking = state.bookings[week];
  if (booking) return refuse(`Trekningen om ${uke(week)} er gjort. Uka gikk til ${booking.name}.`);
  return null;
}

/** Text with the characters that cannot be seen taken out, and the blanks gathered into single spaces. */
function tidy(text) {
  return String(text ?? '')
    // Before NFC: a mark between a letter and its accent would otherwise keep them from joining.
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}⠀]/gu, '')
    .normalize('NFC')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
}

function refuse(message, status = 409) {
  return { ok: false, status, message };
}

function done(more = {}) {
  return { ok: true, ...more };
}
