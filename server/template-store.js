const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(os.homedir(), '.claude-code-control');
const GLOBAL_FILE = path.join(DATA_DIR, 'templates.json');
const LEGACY_DIR = path.join(DATA_DIR, 'templates');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
  ensureDataDir();
  if (!fs.existsSync(GLOBAL_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(GLOBAL_FILE, 'utf8')); } catch (_) { return []; }
}

function writeAll(arr) {
  ensureDataDir();
  fs.writeFileSync(GLOBAL_FILE, JSON.stringify(arr, null, 2));
}

function list() {
  return readAll();
}

function add({ name, prompt, dir }) {
  const all = readAll();
  const template = {
    id: uuidv4(),
    name: String(name).trim(),
    prompt: String(prompt).trim(),
    dir: String(dir).trim(),
    createdAt: new Date().toISOString(),
  };
  all.push(template);
  writeAll(all);
  return template;
}

function update(id, patch) {
  const all = readAll();
  const idx = all.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const allowed = ['name', 'prompt', 'dir'];
  for (const key of allowed) {
    if (typeof patch[key] === 'string' && patch[key].trim()) {
      all[idx][key] = patch[key].trim();
    }
  }
  writeAll(all);
  return all[idx];
}

function remove(id) {
  const all = readAll().filter(t => t.id !== id);
  writeAll(all);
}

// Recover the real directory path from the lossy hyphen-encoded form.
// The encoding `dir.replace(/\//g, '-')` is ambiguous: any `-` in the dir name
// becomes indistinguishable from a `/`. We resolve by consulting
// ~/.claude/projects/<same-encoded>/*.jsonl, whose first event records the
// canonical `cwd`. Falls back to the naive decode if Claude has no record.
function decodeDir(encoded) {
  const claudeProj = path.join(os.homedir(), '.claude', 'projects', encoded);
  if (fs.existsSync(claudeProj)) {
    try {
      const jsonlFiles = fs.readdirSync(claudeProj).filter(f => f.endsWith('.jsonl'));
      for (const jsonl of jsonlFiles) {
        const content = fs.readFileSync(path.join(claudeProj, jsonl), 'utf8');
        for (const line of content.split('\n')) {
          if (!line.includes('"cwd"')) continue;
          try {
            const cwd = JSON.parse(line).cwd;
            if (cwd) return cwd;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
  // Fallback: replace all hyphens with `/`, prepend `/` if missing.
  let dir = encoded.replace(/-/g, '/');
  if (!dir.startsWith('/')) dir = '/' + dir;
  return dir;
}

// One-shot migration from old per-dir storage.
// Old format: ~/.claude-code-control/templates/<encoded-dir>.json (array of {id,name,prompt,createdAt})
function migrate() {
  if (!fs.existsSync(LEGACY_DIR)) return;
  try {
    const files = fs.readdirSync(LEGACY_DIR).filter(f => f.endsWith('.json'));
    if (!files.length) {
      try { fs.rmdirSync(LEGACY_DIR); } catch (_) {}
      return;
    }

    const existing = readAll();
    const existingIds = new Set(existing.map(t => t.id));
    let added = 0;

    for (const f of files) {
      const encoded = f.replace(/\.json$/, '');
      const dir = decodeDir(encoded);

      let arr = [];
      try { arr = JSON.parse(fs.readFileSync(path.join(LEGACY_DIR, f), 'utf8')); } catch (_) { continue; }
      if (!Array.isArray(arr)) continue;

      for (const t of arr) {
        if (!t || !t.id || existingIds.has(t.id)) continue;
        existing.push({
          id: t.id,
          name: t.name || 'Untitled',
          prompt: t.prompt || '',
          dir,
          createdAt: t.createdAt || new Date().toISOString(),
        });
        existingIds.add(t.id);
        added++;
      }
    }

    if (added) writeAll(existing);

    for (const f of files) {
      try { fs.unlinkSync(path.join(LEGACY_DIR, f)); } catch (_) {}
    }
    try { fs.rmdirSync(LEGACY_DIR); } catch (_) {}

    if (added) console.log(`[template-store] Migrated ${added} template(s) from legacy storage.`);
  } catch (e) {
    console.error('[template-store] Migration failed:', e.message);
  }
}

module.exports = { list, add, update, remove, migrate };
