// Minimal in-process async mutex, keyed by file path.
//
// Fixes the capacity race condition: two people registering for the last
// spot at nearly the same moment could both read the same "1 spot left"
// state before either write happened, and both get in — overbooking the
// event. This doesn't need a database; it just needs registrations for the
// SAME event file to never overlap their read-check-write cycle within this
// Node process, which is exactly what's serving all requests.
//
// Usage:
//   await withFileLock(filePath, async () => { ...read, check, write... });
const locks = new Map(); // filePath -> Promise chain

export function withFileLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => (release = resolve));
  locks.set(key, previous.then(() => current));

  return previous
    .then(() => fn())
    .finally(() => {
      release();
      if (locks.get(key) === current) locks.delete(key);
    });
}
