'use strict';
// Optional cloud save for free hosts that have no persistent disk.
// The whole game state is one JSON document kept in a single Postgres row
// (fine for thousands of players). Works with any Postgres, e.g. a free Neon database.
const { Pool } = require('pg');

class PgSync {
  constructor(url) {
    this.pool = new Pool({
      connectionString: url, max: 2,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    });
    this.pending = null; this.inFlight = null;
  }
  async load() {
    await this.pool.query('CREATE TABLE IF NOT EXISTS rb21_state (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const r = await this.pool.query('SELECT data FROM rb21_state WHERE id = 1');
    return r.rows[0] ? r.rows[0].data : null;
  }
  // Coalesces rapid saves: at most one write in flight, and the latest state always wins.
  push(json) {
    this.pending = json;
    if (!this.inFlight) this.inFlight = this.drain();
    return this.inFlight;
  }
  async drain() {
    try {
      while (this.pending) {
        const json = this.pending; this.pending = null;
        for (let attempt = 1; ; attempt++) {
          try {
            await this.pool.query('INSERT INTO rb21_state (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [json]);
            break;
          } catch (e) {
            console.error(`[db] save failed (attempt ${attempt}):`, e.message);
            if (attempt >= 5) { this.pending = this.pending || json; throw e; }
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }
    } catch { /* kept in this.pending; the next save retries */ }
    finally { this.inFlight = null; }
  }
  async flush() {
    for (let i = 0; i < 3 && (this.pending || this.inFlight); i++) {
      if (!this.inFlight) this.inFlight = this.drain();
      await this.inFlight;
    }
  }
  close() { return this.pool.end(); }
}
module.exports = { PgSync };
