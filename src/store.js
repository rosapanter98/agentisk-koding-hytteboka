// The book is one JSON file, read when the server starts and written after every change.
// The server is a single process and a rule runs from start to end without waiting for anything,
// so two people who press at the same moment are still answered one after the other.

import * as nodeFs from 'node:fs';
import { dirname } from 'node:path';

// Windows now and then refuses to move a file into place for a moment, because something else has it open.
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
const WAITS_MS = [5, 10, 20, 40, 50];

/**
 * Opens the book in `file`. A file that is not there yet is made from `first()`.
 * `fs` is the file system to use, so that a test can make it misbehave.
 */
export function openStore(file, first, fs = nodeFs) {
  let state;
  if (fs.existsSync(file)) {
    state = read(fs, file);
  } else {
    state = first();
    write(fs, file, state);
  }

  return {
    get state() {
      return state;
    },

    /** Lets one rule change the book. What the rule did is kept only when it said yes and the file is written. */
    change(rule, wish) {
      const next = structuredClone(state);
      const answer = rule(next, wish);
      if (answer.ok) {
        write(fs, file, next);
        state = next;
      }
      return answer;
    },
  };
}

// A file that cannot be read, or is not a book, stops the server here, rather than being replaced by an empty book.
function read(fs, file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const stop = (why) => new SyntaxError(`Boka ${file} kan ikke leses: ${why}. Filen er ikke endret.`);

  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    throw stop(error.message);
  }
  if (!isBook(state)) throw stop('den har ikke bookings og draws slik en bok skal ha');
  return state;
}

/** Only what the rules lean on: other fields are let through. */
function isBook(state) {
  return (
    isObject(state) &&
    isObject(state.bookings) &&
    Object.values(state.bookings).every((booking) => isObject(booking) && typeof booking.name === 'string') &&
    isObject(state.draws) &&
    Object.values(state.draws).every(
      (draw) =>
        isObject(draw) &&
        Array.isArray(draw.entries) &&
        draw.entries.every((entry) => isObject(entry) && typeof entry.name === 'string'),
    )
  );
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function write(fs, file, state) {
  // Written beside the file and moved into place, so a crash halfway leaves the old book whole.
  fs.mkdirSync(dirname(file), { recursive: true });
  const draft = `${file}.ny`;
  try {
    const handle = fs.openSync(draft, 'w');
    try {
      fs.writeFileSync(handle, `${JSON.stringify(state, null, 2)}\n`);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    moveIntoPlace(fs, draft, file);
  } catch (error) {
    try {
      fs.rmSync(draft, { force: true });
    } catch {} // the error that matters is the one being thrown
    throw error;
  }
}

function moveIntoPlace(fs, from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fs.renameSync(from, to);
    } catch (error) {
      if (!BUSY.has(error.code) || attempt === WAITS_MS.length) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAITS_MS[attempt]);
    }
  }
}
