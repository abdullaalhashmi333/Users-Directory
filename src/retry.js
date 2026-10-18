'use strict';

// Calls fn until it succeeds, up to `attempts` times, waiting `delayMs` between tries.
async function retry(fn, { attempts = 20, delayMs = 3000, onError = () => {} } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      onError(err, i, attempts);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

module.exports = { retry };
