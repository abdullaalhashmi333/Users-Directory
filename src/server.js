'use strict';

const { openDb, defaultDbPath } = require('./db');
const { createApp } = require('./app');

const dbPath = defaultDbPath();
const app = createApp(openDb(dbPath));
const port = Number(process.env.PORT) || 3000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Users Directory listening on port ${port} (database: ${dbPath})`);
});
