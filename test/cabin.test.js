import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  book, calendar, cancel, drawWinner, emptyState, enter, firstState, HORIZON, markDraw, readName, sameName,
  unmarkDraw, withdraw,
} from '../src/cabin.js';

// The week the tests happen in: 12 to 18 October 2026.
const TODAY = '2026-W42';
const AUTUMN = '2026-W45';
const EASTER = '2027-W12';
const NOW = '2026-10-14T08:00:00.000Z';

const as = (name, week) => ({ name, week, today: TODAY, now: NOW });

/** A book where a winner is to be drawn for Easter. */
function bookWithEaster(...entered) {
  const state = emptyState();
  state.draws[EASTER] = { label: 'Påske', entries: [] };
  for (const name of entered) assert.equal(enter(state, as(name, EASTER)).ok, true);
  return state;
}

/** Checks that a rule said no, with the words it used, and left the book as it was. */
function refused(state, rule, wish, words, status = 409) {
  const before = structuredClone(state);
  const answer = rule(state, wish);
  assert.equal(answer.ok, false);
  assert.equal(answer.status, status);
  assert.match(answer.message, words);
  assert.deepEqual(state, before, 'a refused wish changes nothing');
}

describe('booking a week', () => {
  test('a free week goes to the one who books it', () => {
    const state = emptyState();
    assert.deepEqual(book(state, as('Ola Nordmann', AUTUMN)), { ok: true });
    assert.deepEqual(state.bookings[AUTUMN], { name: 'Ola Nordmann', at: NOW });
  });

  test('a week that is taken cannot be booked by someone else', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    refused(state, book, as('Kari Hansen', AUTUMN), /Uke 45 er allerede booket av Ola Nordmann/);
    assert.equal(state.bookings[AUTUMN].name, 'Ola Nordmann');
  });

  test('the one who has the week is told so when they book it again', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    refused(state, book, as('ola nordmann', AUTUMN), /Du har allerede uke 45/);
  });

  test('the week we are in can be booked, and the last of the 52', () => {
    const state = emptyState();
    assert.equal(book(state, as('Ola Nordmann', TODAY)).ok, true);
    assert.equal(book(state, as('Ola Nordmann', '2027-W40')).ok, true);
  });

  test('a week that is over, too far ahead or not a week cannot be booked', () => {
    const state = emptyState();
    refused(state, book, as('Ola Nordmann', '2026-W41'), /Uke 41 er over/);
    refused(state, book, as('Ola Nordmann', '2027-W41'), /for langt fram/);
    refused(state, book, as('Ola Nordmann', '2027-W53'), /finnes ikke/, 404);
    refused(state, book, as('Ola Nordmann', 'tull'), /finnes ikke/, 404);
  });

  test('nobody books without a name', () => {
    const state = emptyState();
    refused(state, book, as('', AUTUMN), /Skriv navnet ditt/, 400);
    refused(state, book, as('   ', AUTUMN), /Skriv navnet ditt/, 400);
    refused(state, book, as('\u200B\u2800', AUTUMN), /Skriv navnet ditt/, 400);
    refused(state, book, as('́', AUTUMN), /Skriv navnet ditt/, 400);
    refused(state, book, as('. - .', AUTUMN), /Skriv navnet ditt/, 400);
    refused(state, book, as('x'.repeat(61), AUTUMN), /Skriv navnet ditt/, 400);
  });

  test('a name is the same however it is typed', () => {
    assert.equal(readName('  Ola \t Nordmann\n'), 'Ola Nordmann');
    assert.equal(sameName('Ola Nordmann', ' ola   NORDMANN '), true);
    assert.equal(sameName('Åse Ødegård', 'åse ødegård'), true);
    assert.equal(sameName('Ola Nordmann', 'Ola Normann'), false);
  });

  test('characters that cannot be seen do not make another name', () => {
    for (const mark of ['\u200B', '\u00AD', '\u200E', '\u2060', '\u034F', '\u0600', '\uFFF9', '\u2800', '\u3164']) {
      assert.equal(readName(`Ola${mark} Nordmann${mark}`), 'Ola Nordmann');
      assert.equal(sameName('Ola Nordmann', `Ola ${mark}Nordmann`), true);
    }
    assert.equal(readName('Ola\u200BNordmann'), 'OlaNordmann', 'they are taken out, not turned into a space');
  });

  test('a mark between a letter and its accent does not make another name', () => {
    assert.equal(sameName('Åse', 'A\u200B̊se'), true);
    assert.equal(readName('Åse'), 'Åse');
    const once = readName('A\u200B̊\u00AD se');
    assert.equal(readName(once), once, 'tidying twice changes nothing more');
  });
});

describe('giving a week up', () => {
  test('the one who has the week can give it up, whatever hidden marks their name carries', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    assert.equal(cancel(state, as('Ola\u200B Nordmann', AUTUMN)).ok, true);
    assert.equal(state.bookings[AUTUMN], undefined);
  });

  test('the one who has the week can give it up, and then it is free', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    assert.equal(cancel(state, as('ola nordmann', AUTUMN)).ok, true);
    assert.equal(state.bookings[AUTUMN], undefined);
    assert.equal(book(state, as('Kari Hansen', AUTUMN)).ok, true);
  });

  test('nobody gives up a week that is someone else’s', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    refused(state, cancel, as('Kari Hansen', AUTUMN), /booket av Ola Nordmann, ikke av deg/, 403);
  });

  test('a week nobody has cannot be given up', () => {
    refused(emptyState(), cancel, as('Ola Nordmann', AUTUMN), /Uke 45 er ikke booket/);
  });
});

describe('entering a draw', () => {
  test('a week a winner is drawn for cannot be booked', () => {
    const state = bookWithEaster();
    refused(state, book, as('Ola Nordmann', EASTER), /Det trekkes lodd om uke 12/);
  });

  test('those who want the week enter, in the order they came', () => {
    const state = bookWithEaster('Ola Nordmann', 'Kari Hansen');
    assert.deepEqual(state.draws[EASTER].entries.map((entry) => entry.name), ['Ola Nordmann', 'Kari Hansen']);
    assert.equal(state.bookings[EASTER], undefined);
  });

  test('one person has one ticket', () => {
    const state = bookWithEaster('Ola Nordmann');
    refused(state, enter, as('OLA NORDMANN', EASTER), /Du er allerede påmeldt/);
    refused(state, enter, as('Ola\u200B Nordmann', EASTER), /Du er allerede påmeldt/);
    assert.equal(withdraw(state, as('Ola\u200B Nordmann', EASTER)).ok, true);
  });

  test('someone who entered can leave again', () => {
    const state = bookWithEaster('Ola Nordmann', 'Kari Hansen');
    assert.equal(withdraw(state, as('ola nordmann', EASTER)).ok, true);
    assert.deepEqual(state.draws[EASTER].entries.map((entry) => entry.name), ['Kari Hansen']);
    refused(state, withdraw, as('Ola Nordmann', EASTER), /Du er ikke påmeldt/);
  });

  test('there is no draw to enter for an ordinary week', () => {
    refused(emptyState(), enter, as('Ola Nordmann', AUTUMN), /Det trekkes ikke lodd om uke 45/);
    refused(emptyState(), withdraw, as('Ola Nordmann', AUTUMN), /Det trekkes ikke lodd om uke 45/);
  });

  test('nobody enters without a name, or for a week that is over', () => {
    const state = bookWithEaster();
    refused(state, enter, as('', EASTER), /Skriv navnet ditt/, 400);
    state.draws['2026-W41'] = { label: '', entries: [] };
    refused(state, enter, as('Ola Nordmann', '2026-W41'), /Uke 41 er over/);
  });
});

describe('drawing the winner', () => {
  const people = ['Ola Nordmann', 'Kari Hansen', 'Per Olsen'];
  const draw = (state, pick) => drawWinner(state, { week: EASTER, today: TODAY, now: NOW, pick });

  test('the one whose ticket is picked gets the week', () => {
    const state = bookWithEaster(...people);
    const asked = [];
    const answer = draw(state, (count) => {
      asked.push(count);
      return 1;
    });

    assert.deepEqual(answer, { ok: true, winner: 1, entries: people });
    assert.deepEqual(asked, [3], 'one pick among the three tickets');
    assert.deepEqual(state.bookings[EASTER], { name: 'Kari Hansen', at: NOW });
    assert.equal(state.draws[EASTER].entries.length, 3, 'the tickets stay, to show who was in the draw');
  });

  test('every ticket can win', () => {
    for (const [index, name] of people.entries()) {
      const state = bookWithEaster(...people);
      draw(state, () => index);
      assert.equal(state.bookings[EASTER].name, name);
    }
  });

  test('left to itself, the draw gives everyone the same chance', () => {
    // Chi-square: how far the wins are from an even split, with 3 and then 7 tickets (2 and 6 degrees of freedom).
    // For an even number of degrees, 2m, P(X > x) = exp(-x/2) * (1 + x/2 + ... + (x/2)^(m-1) / (m-1)!).
    // The values below are the x where that is 5e-7, rounded up. Two checks at 5e-7 fail by chance less than
    // once in a million runs. A draw that gives one ticket 3.2% (3 tickets) or 6% (7 tickets) more than its
    // fair share is caught all but about once in a million runs too.
    const critical = { 3: 29.02, 7: 39.8 };
    for (const tickets of [3, 7]) {
      const state = bookWithEaster(...Array.from({ length: tickets }, (_, index) => `Person ${index + 1}`));
      const wins = new Array(tickets).fill(0);
      for (let round = 0; round < 200_000; round += 1) {
        delete state.bookings[EASTER];
        wins[drawWinner(state, { week: EASTER, today: TODAY, now: NOW }).winner] += 1;
      }

      const expected = 200_000 / tickets;
      const chiSquare = wins.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
      assert.ok(chiSquare < critical[tickets], `${tickets} tickets: chi-square ${chiSquare.toFixed(1)}, wins were ${wins}`);
    }
  });

  test('a single ticket wins', () => {
    const state = bookWithEaster('Ola Nordmann');
    assert.equal(drawWinner(state, { week: EASTER, today: TODAY, now: NOW }).winner, 0);
    assert.equal(state.bookings[EASTER].name, 'Ola Nordmann');
  });

  test('there is nothing to draw before someone has entered', () => {
    refused(bookWithEaster(), drawWinner, { week: EASTER, today: TODAY, now: NOW }, /Ingen har meldt seg på/);
  });

  test('a winner is drawn once', () => {
    const state = bookWithEaster(...people);
    draw(state, () => 0);
    refused(state, drawWinner, { week: EASTER, today: TODAY, now: NOW, pick: () => 2 }, /er gjort. Uka gikk til Ola Nordmann/);
  });

  test('no winner is drawn for an ordinary week', () => {
    refused(emptyState(), drawWinner, { week: AUTUMN, today: TODAY, now: NOW }, /Det trekkes ikke lodd om uke 45/);
  });

  test('after the draw nobody enters, leaves or books the week', () => {
    const state = bookWithEaster(...people);
    draw(state, () => 0);
    refused(state, enter, as('Nina Berg', EASTER), /Trekningen om uke 12 er gjort/);
    refused(state, withdraw, as('Kari Hansen', EASTER), /Trekningen om uke 12 er gjort/);
    refused(state, book, as('Nina Berg', EASTER), /gikk til Ola Nordmann/);
  });

  test('a winner who gives the week up is out, and it is drawn again among the others', () => {
    const state = bookWithEaster(...people);
    draw(state, () => 0);
    refused(state, cancel, as('Kari Hansen', EASTER), /ikke av deg/, 403);

    assert.equal(cancel(state, as('Ola Nordmann', EASTER)).ok, true);
    assert.equal(state.bookings[EASTER], undefined);
    assert.deepEqual(state.draws[EASTER].entries.map((entry) => entry.name), ['Kari Hansen', 'Per Olsen']);

    assert.equal(enter(state, as('Nina Berg', EASTER)).ok, true, 'the draw is open again');
    assert.deepEqual(draw(state, () => 2), { ok: true, winner: 2, entries: ['Kari Hansen', 'Per Olsen', 'Nina Berg'] });
    assert.equal(state.bookings[EASTER].name, 'Nina Berg');
  });

  test('a winner who gave the week up cannot enter that draw again, and the others still can', () => {
    const state = bookWithEaster(...people);
    draw(state, () => 0);
    assert.equal(cancel(state, as('Ola Nordmann', EASTER)).ok, true);
    assert.deepEqual(state.draws[EASTER].out, ['Ola Nordmann']);

    refused(state, enter, as(' ola  NORDMANN ', EASTER), /Du ga fra deg uke 12 og kan ikke melde deg på trekningen om den igjen/);
    assert.equal(enter(state, as('Nina Berg', EASTER)).ok, true);

    // The next winner gives up too: both are out, and whoever is left is drawn.
    draw(state, () => 0);
    assert.equal(cancel(state, as('Kari Hansen', EASTER)).ok, true);
    assert.deepEqual(state.draws[EASTER].out, ['Ola Nordmann', 'Kari Hansen']);
    refused(state, enter, as('Kari Hansen', EASTER), /kan ikke melde deg på/);
    refused(state, enter, as('Ola Nordmann', EASTER), /kan ikke melde deg på/);
    assert.deepEqual(draw(state, () => 1), { ok: true, winner: 1, entries: ['Per Olsen', 'Nina Berg'] });
  });

  test('someone who only left the draw can enter again', () => {
    const state = bookWithEaster('Ola Nordmann');
    assert.equal(withdraw(state, as('Ola Nordmann', EASTER)).ok, true);
    assert.equal(enter(state, as('Ola Nordmann', EASTER)).ok, true);
    assert.equal(state.draws[EASTER].out, undefined);
  });
});

describe('choosing the weeks a winner is drawn for', () => {
  const choose = (week, label = '') => ({ week, label, today: TODAY });

  test('a free week can be set up for a draw, with a name', () => {
    const state = emptyState();
    assert.equal(markDraw(state, choose(AUTUMN, '  Høstferie ')).ok, true);
    assert.deepEqual(state.draws[AUTUMN], { label: 'Høstferie', entries: [] });
    refused(state, book, as('Ola Nordmann', AUTUMN), /Det trekkes lodd om uke 45/);
  });

  test('a week that is booked, or already set up, cannot be', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    refused(state, markDraw, choose(AUTUMN), /allerede booket av Ola Nordmann/);
    markDraw(state, choose('2026-W46'));
    refused(state, markDraw, choose('2026-W46'), /Det trekkes allerede lodd om uke 46/);
  });

  test('a week that is over or does not exist cannot be, nor one with a name that is too long', () => {
    const state = emptyState();
    refused(state, markDraw, choose('2026-W41'), /er over/);
    refused(state, markDraw, choose('ingen uke'), /finnes ikke/, 404);
    refused(state, markDraw, choose(AUTUMN, 'x'.repeat(41)), /40 tegn/, 400);
  });

  test('a draw nobody has entered can be made an ordinary week again', () => {
    const state = bookWithEaster();
    assert.equal(unmarkDraw(state, choose(EASTER)).ok, true);
    assert.equal(state.draws[EASTER], undefined);
    assert.equal(book(state, as('Ola Nordmann', EASTER)).ok, true);
  });

  test('a draw someone has entered, or that is done, stays a draw', () => {
    const state = bookWithEaster('Ola Nordmann');
    refused(state, unmarkDraw, choose(EASTER), /1 har meldt seg på/);
    drawWinner(state, { week: EASTER, today: TODAY, now: NOW });
    refused(state, unmarkDraw, choose(EASTER), /Trekningen om uke 12 er gjort/);
    refused(state, unmarkDraw, choose(AUTUMN), /Det trekkes ikke lodd om uke 45/);
  });
});

describe('the book as it is shown', () => {
  test('the calendar is the 52 weeks from this one, each with what stands about it', () => {
    const state = bookWithEaster('Kari Hansen');
    book(state, as('Ola Nordmann', AUTUMN));
    const weeks = calendar(state, TODAY);

    assert.equal(weeks.length, HORIZON);
    assert.equal(weeks[0].week, TODAY);
    assert.equal(weeks.at(-1).week, '2027-W40');
    assert.deepEqual(weeks[0], { week: TODAY, booking: null, draw: null });
    assert.equal(weeks.find((entry) => entry.week === AUTUMN).booking.name, 'Ola Nordmann');
    assert.equal(weeks.find((entry) => entry.week === EASTER).draw.label, 'Påske');
  });

  test('a new book has Easter and the winter break set up for a draw', () => {
    const state = firstState(new Date('2026-10-11T12:00:00Z'));
    assert.deepEqual(state.bookings, {});
    assert.deepEqual(state.draws, {
      '2027-W08': { label: 'Vinterferie', entries: [] },
      '2027-W12': { label: 'Påske', entries: [] },
    });
  });

  test('a new book takes this year’s weeks while they are still ahead', () => {
    const state = firstState(new Date('2027-01-11T12:00:00Z'));
    assert.deepEqual(Object.keys(state.draws), ['2027-W08', '2027-W12']);
  });

  test('a new book leaves out an Easter that is more than 52 weeks away', () => {
    // The week after Easter 2027. Easter 2028 is in week 15, 54 weeks later.
    const state = firstState(new Date('2027-03-29T12:00:00Z'));
    assert.deepEqual(Object.keys(state.draws), ['2028-W08']);
  });
});
