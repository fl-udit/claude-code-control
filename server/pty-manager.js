const pty = require('node-pty');
const os = require('os');
const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

const ptys = new Map();
const outputBuffers = new Map(); // sessionId -> string (last ~100KB of output)
const BUFFER_LIMIT = 100 * 1024;

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

  outputBuffers.set(sessionId, '');

  ptyProcess.onData((data) => {
    let buf = (outputBuffers.get(sessionId) || '') + data;
    if (buf.length > BUFFER_LIMIT) buf = buf.slice(buf.length - BUFFER_LIMIT);
    outputBuffers.set(sessionId, buf);
    emitter.emit(`data:${sessionId}`, data);
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
  outputBuffers.delete(sessionId);
}

module.exports = { spawn, write, resize, kill, isAlive, getBuffer, clearBuffer, emitter };
