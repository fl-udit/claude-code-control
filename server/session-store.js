const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(os.homedir(), '.claude-code-control');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const sessions = new Map();

function load() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      for (const session of data) {
        sessions.set(session.id, { ...session, status: 'exited' });
      }
    }
  } catch (e) {
    console.error('Failed to load sessions:', e.message);
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Array.from(sessions.values()), null, 2));
  } catch (e) {
    console.error('Failed to save sessions:', e.message);
  }
}

function create(dir, name) {
  const id = uuidv4();
  const session = {
    id,
    name: name || path.basename(dir),
    dir,
    pid: null,
    status: 'starting',
    autoRestart: false,
    createdAt: new Date().toISOString(),
  };
  sessions.set(id, session);
  save();
  return session;
}

function get(id) {
  return sessions.get(id) || null;
}

function list() {
  return Array.from(sessions.values());
}

function update(id, patch) {
  const session = sessions.get(id);
  if (!session) return null;
  Object.assign(session, patch);
  save();
  return session;
}

function remove(id) {
  sessions.delete(id);
  save();
}

module.exports = { load, create, get, list, update, remove };
