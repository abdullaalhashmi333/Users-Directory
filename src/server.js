'use strict';

const { createPool } = require('./db');
const { createApp, initDatabase } = require('./app');
const { retry } = require('./retry');

async function main() {
  const pool = createPool();
  // A database that was just added on Railway can take a little while to accept
  // connections, so start-up retries for up to a minute before giving up.
  const result = await retry(() => initDatabase(pool), {
    attempts: 20,
    delayMs: 3000,
    onError: (err, i, n) => console.error(`Database not ready (attempt ${i}/${n}): ${err.code || ''} ${err.message}`),
  });
  if (result.adminCreated) console.log('Created the first admin account from ADMIN_USERNAME.');
  if (result.seeded) console.log('Loaded sample data into the empty directory (SEED_SAMPLE_DATA=true).');

  const app = createApp(pool);
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, '0.0.0.0', () => console.log(`Users Directory listening on port ${port}`));

  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
