'use strict';
const fs = require('fs');
const path = require('path');

// Small JSON document store with debounced atomic writes (tmp file + rename).
class Store {
  constructor(file) {
    this.file = file;
    this.data = { users: {}, emailIndex: {}, tournaments: {}, payments: {} };
    this.timer = null;
    if (fs.existsSync(file)) Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250);
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
module.exports = { Store };
