const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const sessionStore = require('./session-store');
const ptyManager = require('./pty-manager');
const templateStore = require('./template-store');
const api = require('./api');

templateStore.migrate();

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));
app.use('/api', api);


const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/ws\/([^/?]+)/);
  if (!match) { socket.destroy(); return; }
  const sessionId = match[1];
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, sessionId);
  });
});

wss.on('connection', (ws, req, sessionId) => {
  const session = sessionStore.get(sessionId);
  if (!session) {
    ws.close(1008, 'Session not found');
    return;
  }

  // Replay buffered output so exited sessions show their last screen state
  const buffered = ptyManager.getBuffer(sessionId);
  if (buffered && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'output', data: buffered }));
  }

  // If already exited, tell the client immediately after replaying buffer
  if (session.status === 'exited') {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: null }));
    }
    ws.close();
    return;
  }

  const onData = (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  };

  const onExit = (code) => {
    const current = sessionStore.get(sessionId);
    if (current?.autoRestart) {
      setTimeout(() => {
        try {
          const pid = ptyManager.spawn(sessionId, current.dir, ['--continue']);
          sessionStore.update(sessionId, { pid, status: 'running' });
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'restarted' }));
          }
          // Re-register so subsequent exits are also handled
          ptyManager.emitter.once(`exit:${sessionId}`, onExit);
        } catch (_) {
          sessionStore.update(sessionId, { status: 'exited' });
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'exit', code }));
          }
        }
      }, 1500);
    } else {
      sessionStore.update(sessionId, { status: 'exited' });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code }));
      }
    }
  };

  ptyManager.emitter.on(`data:${sessionId}`, onData);
  ptyManager.emitter.once(`exit:${sessionId}`, onExit);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input') ptyManager.write(sessionId, msg.data);
      else if (msg.type === 'resize') ptyManager.resize(sessionId, msg.cols, msg.rows);
    } catch (_) {}
  });

  ws.on('close', () => {
    ptyManager.emitter.off(`data:${sessionId}`, onData);
    ptyManager.emitter.off(`exit:${sessionId}`, onExit);
  });
});

const wasRunning = sessionStore.load();
for (const sessionId of wasRunning) {
  const session = sessionStore.get(sessionId);
  if (!session) continue;
  // Kill the orphaned process from the previous server run so it doesn't
  // appear in the discovered-sessions list after the new one is spawned.
  if (session.pid) {
    try { process.kill(session.pid, 'SIGTERM'); } catch (_) {}
  }
  try {
    const pid = ptyManager.spawn(sessionId, session.dir, ['--continue']);
    sessionStore.update(sessionId, { pid, status: 'running' });
    console.log(`  ↺  Resumed: ${session.name}`);
  } catch (e) {
    console.error(`  ✗  Failed to resume ${session.name}:`, e.message);
  }
}

server.listen(PORT, () => {
  console.log(`\nClaude Code Control → http://localhost:${PORT}\n`);
});
