'use strict';
// Entry point. With DATABASE_URL set (free hosts with no disk), game state is loaded from Postgres
// before the server starts and saved back after every change. Without it, it uses the local file.
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  if (process.env.DATABASE_URL) {
    const { PgSync } = require('./lib/pgsync');
    const db = new PgSync(process.env.DATABASE_URL);
    let data;
    for (let attempt = 1; ; attempt++) {
      try { data = await db.load(); break; }
      catch (e) {
        console.error(`[db] cannot reach database (attempt ${attempt}):`, e.message);
        if (attempt >= 10) process.exit(1);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    process.env.DATA_FILE = path.join(os.tmpdir(), 'rb21-db.json');
    if (data) fs.writeFileSync(process.env.DATA_FILE, JSON.stringify(data));
    else if (fs.existsSync(process.env.DATA_FILE)) fs.unlinkSync(process.env.DATA_FILE);
    global.__RB21_REMOTE = db;
    console.log(`[db] ${data ? 'loaded saved game state' : 'new database, starting fresh'}`);
  }
  const { server, store } = require('./server');
  if (store.remote) store.flush(); // make sure the database has the current state (e.g. new admin account)
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(`Blackjack running on port ${port}`));
})();
