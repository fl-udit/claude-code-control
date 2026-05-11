const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

const ptys = new Map();
const outputBuffers = new Map(); // sessionId -> string (last ~100KB of output)
const bufferSaveTimers = new Map();
const BUFFER_LIMIT = 100 * 1024;
const BUFFERS_DIR = path.join(os.homedir(), '.claude-code-control', 'buffers');

function saveBufferToDisk(sessionId) {
  try {
    fs.mkdirSync(BUFFERS_DIR, { recursive: true });
    fs.writeFileSync(path.join(BUFFERS_DIR, sessionId), outputBuffers.get(sessionId) || '');
  } catch (_) {}
}

// Augment PATH with common user binary locations so claude is discoverable
const augmentedEnv = {
  ...process.env,
  PATH: [
    process.env.PATH,
    `${os.homedir()}/.local/bin`,
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ].filter(Boolean).join(':'),
  TERM: 'xterm-color',
};

function spawn(sessionId, dir, flags = []) {
  const ptyProcess = pty.spawn('claude', flags, {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: dir,
    env: augmentedEnv,
  });

  ptys.set(sessionId, ptyProcess);

  const diskBuffer = (() => {
    try {
      const p = path.join(BUFFERS_DIR, sessionId);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    } catch (_) { return ''; }
  })();
  outputBuffers.set(sessionId, diskBuffer);

  ptyProcess.onData((data) => {
    let buf = (outputBuffers.get(sessionId) || '') + data;
    if (buf.length > BUFFER_LIMIT) buf = buf.slice(buf.length - BUFFER_LIMIT);
    outputBuffers.set(sessionId, buf);
    emitter.emit(`data:${sessionId}`, data);
    if (bufferSaveTimers.has(sessionId)) clearTimeout(bufferSaveTimers.get(sessionId));
    bufferSaveTimers.set(sessionId, setTimeout(() => saveBufferToDisk(sessionId), 1000));
  });

  ptyProcess.onExit(({ exitCode }) => {
    ptys.delete(sessionId);
    emitter.emit(`exit:${sessionId}`, exitCode);
  });

  return ptyProcess.pid;
}

function write(sessionId, data) {
  const p = ptys.get(sessionId);
  if (p) p.write(data);
}

function resize(sessionId, cols, rows) {
  const p = ptys.get(sessionId);
  if (p) p.resize(cols, rows);
}

function kill(sessionId) {
  const p = ptys.get(sessionId);
  if (p) {
    p.kill();
    ptys.delete(sessionId);
  }
}

function isAlive(sessionId) {
  return ptys.has(sessionId);
}

function getBuffer(sessionId) {
  return outputBuffers.get(sessionId) || '';
}

function clearBuffer(sessionId) {
  if (bufferSaveTimers.has(sessionId)) {
    clearTimeout(bufferSaveTimers.get(sessionId));
    bufferSaveTimers.delete(sessionId);
  }
  try {
    const p = path.join(BUFFERS_DIR, sessionId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
  outputBuffers.delete(sessionId);
}

module.exports = { spawn, write, resize, kill, isAlive, getBuffer, clearBuffer, emitter };
