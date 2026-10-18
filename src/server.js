'use strict';

const { createPool } = require('./db');
const { createApp, initDatabase } = require('./app');

async function main() {
  const pool = createPool();
  const result = await initDatabase(pool);
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
