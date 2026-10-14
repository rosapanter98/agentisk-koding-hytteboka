import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { book, emptyState } from '../src/cabin.js';
import { openStore } from '../src/store.js';

const wish = { week: '2026-W45', name: 'Ola Nordmann', today: '2026-W42', now: '2026-10-14T08:00:00.000Z' };
const onDisk = (file) => JSON.parse(readFileSync(file, 'utf8'));

// Each test has a folder of its own, and they are all removed at the end.
const folders = [];
const newFile = () => {
  folders.push(mkdtempSync(join(tmpdir(), 'hytteboka-')));
  return join(folders.at(-1), 'data', 'bok.json');
};
after(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

test('a book that is not there yet is made, in a folder that is not there yet', () => {
  const file = newFile();
  const store = openStore(file, () => ({ bookings: {}, draws: { '2027-W12': { label: 'Påske', entries: [] } } }));

  assert.equal(store.state.draws['2027-W12'].label, 'Påske');
  assert.deepEqual(onDisk(file), store.state);
});

test('a change is on disk when it is answered, and is there the next time the book is opened', () => {
  const file = newFile();
  const store = openStore(file, emptyState);

  assert.deepEqual(store.change(book, wish), { ok: true });
  assert.equal(onDisk(file).bookings['2026-W45'].name, 'Ola Nordmann');

  const reopened = openStore(file, () => assert.fail('a book that is there is not made again'));
  assert.equal(reopened.state.bookings['2026-W45'].name, 'Ola Nordmann');
  assert.deepEqual(readdirSync(join(file, '..')), ['bok.json'], 'nothing is left beside the book');
});

test('a wish that is refused leaves the book and the file as they were', () => {
  const file = newFile();
  const store = openStore(file, emptyState);
  store.change(book, wish);
  const before = readFileSync(file, 'utf8');
  const stateBefore = store.state;

  const answer = store.change(book, { ...wish, name: 'Kari Hansen' });

  assert.equal(answer.ok, false);
  assert.equal(store.state, stateBefore);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('a rule that changes something and then says no has changed nothing', () => {
  const store = openStore(newFile(), emptyState);
  const answer = store.change((state) => {
    state.bookings['2026-W45'] = { name: 'Halvveis', at: wish.now };
    return { ok: false, status: 409, message: 'Nei' };
  });

  assert.equal(answer.ok, false);
  assert.deepEqual(store.state, emptyState());
});

test('a file that cannot be read stops the start, and is left alone', () => {
  const file = newFile();
  openStore(file, emptyState);
  writeFileSync(file, '{ "bookings": ');

  assert.throws(() => openStore(file, emptyState), SyntaxError);
  assert.equal(readFileSync(file, 'utf8'), '{ "bookings": ');
});

const fileHolding = (bytes) => {
  const file = newFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return file;
};

/** A start that is stopped says which file, and the file is not touched: not changed, not replaced, not emptied. */
function assertStopsAndLeavesAlone(bytes) {
  const file = fileHolding(bytes);

  assert.throws(
    () => openStore(file, () => assert.fail('a book that is there is not made again')),
    (error) => error instanceof SyntaxError && error.message.includes(file),
  );
  assert.deepEqual(readFileSync(file), Buffer.from(bytes));
  assert.deepEqual(readdirSync(dirname(file)), ['bok.json'], 'nothing is left beside the book');
}

for (const text of [
  '{}',
  'null',
  '[]',
  '"bok"',
  '{"bookings":{}}',
  '{"draws":{}}',
  '{"bookings":[],"draws":{}}',
  '{"bookings":{},"draws":[]}',
  '{"bookings":{"2026-W45":null},"draws":{}}',
  '{"bookings":{"2026-W45":"Ola"},"draws":{}}',
  '{"bookings":{"2026-W45":{"at":"x"}},"draws":{}}',
  '{"bookings":{"2026-W45":{"name":7}},"draws":{}}',
  '{"bookings":{},"draws":{"2027-W12":{"label":"Påske"}}}',
  '{"bookings":{},"draws":{"2027-W12":{"entries":{}}}}',
  '{"bookings":{},"draws":{"2027-W12":{"entries":["Ola"]}}}',
  '{"bookings":{},"draws":{"2027-W12":{"entries":[{"at":"x"}]}}}',
]) {
  test(`a file that holds ${text} stops the start, and is left alone`, () => assertStopsAndLeavesAlone(text));
}

test('a file of zero bytes stops the start, and is left alone', () => assertStopsAndLeavesAlone(Buffer.alloc(0)));

test('a book that starts with a byte order mark is read', () => {
  const state = { bookings: { '2026-W45': { name: 'Ola Nordmann', at: wish.now } }, draws: {} };
  const file = fileHolding(`\uFEFF${JSON.stringify(state)}`);

  const store = openStore(file, () => assert.fail('a book that is there is not made again'));

  assert.deepEqual(store.state, state);
  assert.deepEqual(store.change(book, { ...wish, week: '2026-W46' }), { ok: true });
  assert.ok(onDisk(file).bookings['2026-W46'], 'the next write is a plain JSON file');
});

test('fields the book has more than the rules know about are read, and kept', () => {
  const state = {
    version: 2,
    bookings: { '2026-W45': { name: 'Ola Nordmann', at: wish.now, note: 'x' } },
    draws: { '2027-W12': { label: 'Påske', entries: [{ name: 'Kari Hansen', at: wish.now, extra: 1 }], out: [] } },
  };
  const file = fileHolding(JSON.stringify(state));

  const store = openStore(file, () => assert.fail('a book that is there is not made again'));
  store.change(book, { ...wish, week: '2026-W46' });

  assert.deepEqual(store.state.draws, state.draws);
  assert.equal(onDisk(file).version, 2);
  assert.deepEqual(onDisk(file).draws, state.draws);
});

/** A disk that refuses to move the new file into place `failures` times with `code`, as Windows does now and then. */
function flakyDisk() {
  const disk = { code: 'EPERM', failures: 0, attempts: 0 };
  disk.fs = {
    ...nodeFs,
    renameSync(from, to) {
      disk.attempts++;
      if (disk.failures > 0) {
        disk.failures--;
        throw Object.assign(new Error(`${disk.code}: rename '${from}' -> '${to}'`), { code: disk.code });
      }
      return nodeFs.renameSync(from, to);
    },
  };
  return disk;
}

for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
  test(`a move into place refused with ${code} is tried again, and the change is kept`, () => {
    const file = newFile();
    const disk = flakyDisk();
    const store = openStore(file, emptyState, disk.fs);
    Object.assign(disk, { code, failures: 3, attempts: 0 });

    assert.deepEqual(store.change(book, wish), { ok: true });

    assert.equal(disk.attempts, 4);
    assert.equal(onDisk(file).bookings['2026-W45'].name, 'Ola Nordmann');
    assert.equal(store.state.bookings['2026-W45'].name, 'Ola Nordmann');
    assert.deepEqual(readdirSync(dirname(file)), ['bok.json'], 'nothing is left beside the book');
  });
}

test('a move into place that keeps being refused changes nothing, and leaves nothing beside the book', () => {
  const file = newFile();
  const disk = flakyDisk();
  const store = openStore(file, emptyState, disk.fs);
  store.change(book, wish);
  const before = readFileSync(file);
  const stateBefore = store.state;
  Object.assign(disk, { failures: Infinity, attempts: 0 });

  assert.throws(() => store.change(book, { ...wish, week: '2026-W46' }), { code: 'EPERM' });

  assert.equal(disk.attempts, 6);
  assert.equal(store.state, stateBefore);
  assert.deepEqual(readFileSync(file), before);
  assert.deepEqual(readdirSync(dirname(file)), ['bok.json'], 'nothing is left beside the book');
});

test('a move into place that fails for any other reason is not tried again', () => {
  const file = newFile();
  const disk = flakyDisk();
  const store = openStore(file, emptyState, disk.fs);
  Object.assign(disk, { code: 'EIO', failures: Infinity, attempts: 0 });

  assert.throws(() => store.change(book, wish), { code: 'EIO' });

  assert.equal(disk.attempts, 1);
  assert.deepEqual(store.state, emptyState());
  assert.deepEqual(readdirSync(dirname(file)), ['bok.json'], 'nothing is left beside the book');
});

test('the new file is flushed to the disk before it is moved into place', () => {
  const calls = [];
  const watch = (name) => (...args) => (calls.push(name), nodeFs[name](...args));

  openStore(newFile(), emptyState, { ...nodeFs, fsyncSync: watch('fsyncSync'), renameSync: watch('renameSync') });

  assert.deepEqual(calls, ['fsyncSync', 'renameSync']);
});
