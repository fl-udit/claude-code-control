const TERMINAL_THEMES = {
  dark: {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#58a6ff',
    cursorAccent: '#0d1117',
    selectionBackground: 'rgba(88,166,255,0.2)',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  },
  light: {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#0969da',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(9,105,218,0.15)',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f',
  },
};

function getTerminalTheme() {
  return document.body.dataset.theme === 'light' ? TERMINAL_THEMES.light : TERMINAL_THEMES.dark;
}

function applyTerminalTheme() {
  const theme = getTerminalTheme();
  for (const entry of termCache.values()) {
    if (entry.term) entry.term.options.theme = theme;
  }
}

// Per-session terminal state — terminals are kept alive when switching sessions
// so scroll history and screen content are preserved.
const termCache = new Map();
// sessionId -> { term, ws, fitAddon, el, reconnectTimer, resizeObserver }

let currentTerm = null;
let currentWs = null;
let currentSessionId = null;

function openTerminal(session) {
  const container = document.getElementById('terminal-container');

  document.getElementById('terminal-header').style.display = 'flex';
  document.getElementById('slash-toolbar').style.display = 'flex';
  document.getElementById('terminal-dir').textContent = `${session.name}  —  ${session.dir}`;
  updateStatusBadge(session.status);

  // Hide all cached session elements
  for (const cached of termCache.values()) {
    if (cached.el) cached.el.style.display = 'none';
  }

  // Reuse an existing terminal for this session
  if (termCache.has(session.id)) {
    const cached = termCache.get(session.id);
    cached.el.style.display = 'block';
    currentTerm = cached.term;
    currentWs = cached.ws;
    currentSessionId = session.id;
    requestAnimationFrame(() => {
      cached.fitAddon.fit();
      if (cached.ws && cached.ws.readyState === WebSocket.OPEN) {
        cached.ws.send(JSON.stringify({ type: 'resize', cols: cached.term.cols, rows: cached.term.rows }));
      }
    });
    return;
  }

  currentSessionId = session.id;

  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.remove();

  const el = document.createElement('div');
  el.style.cssText = 'height:100%;width:100%;';
  container.appendChild(el);

  const term = new Terminal({
    theme: getTerminalTheme(),
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    scrollback: 5000,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(el);

  const entry = { term, ws: null, fitAddon, el, reconnectTimer: null, resizeObserver: null };
  termCache.set(session.id, entry);

  currentTerm = term;
  currentWs = null;

  requestAnimationFrame(() => fitAddon.fit());

  term.onData((data) => {
    const e = termCache.get(session.id);
    if (e && e.ws && e.ws.readyState === WebSocket.OPEN) {
      e.ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      if (el.offsetWidth === 0) return;
      fitAddon.fit();
      const e = termCache.get(session.id);
      if (e && e.ws && e.ws.readyState === WebSocket.OPEN) {
        e.ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
  });
  resizeObserver.observe(el);
  entry.resizeObserver = resizeObserver;

  connectWs(session, term, fitAddon);
}

function connectWs(session, term, fitAddon) {
  const entry = termCache.get(session.id);
  if (!entry) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/${session.id}`);

  entry.ws = ws;
  if (currentSessionId === session.id) currentWs = ws;

  let firstOutputReceived = false;

  ws.onopen = () => {
    requestAnimationFrame(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        term.write(msg.data);
        if (!firstOutputReceived) {
          firstOutputReceived = true;
          if (typeof pendingPromptBySession !== 'undefined' && pendingPromptBySession.has(session.id)) {
            const queued = pendingPromptBySession.get(session.id);
            pendingPromptBySession.delete(session.id);
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data: queued + '\r' }));
              }
            }, 2000);
          }
        }
      } else if (msg.type === 'exit') {
        if (currentSessionId === session.id) updateStatusBadge('exited');
        updateSidebarStatus(session.id, 'exited');
      } else if (msg.type === 'restarted') {
        if (currentSessionId === session.id) updateStatusBadge('running');
        updateSidebarStatus(session.id, 'running');
      }
    } catch (_) {}
  };

  ws.onclose = () => {
    if (!termCache.has(session.id)) return;
    const e = termCache.get(session.id);
    e.reconnectTimer = setTimeout(() => {
      if (termCache.has(session.id)) connectWs(session, term, fitAddon);
    }, 2000);
  };

  ws.onerror = () => ws.close();
}

// Called when a session is permanently removed
function disposeTerminal(sessionId) {
  const entry = termCache.get(sessionId);
  if (!entry) return;
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  if (entry.ws) { entry.ws.onclose = null; entry.ws.close(); }
  if (entry.resizeObserver) entry.resizeObserver.disconnect();
  if (entry.term) entry.term.dispose();
  if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
  termCache.delete(sessionId);
  if (currentSessionId === sessionId) {
    currentTerm = null;
    currentWs = null;
    currentSessionId = null;
  }
}

function sendSlash(cmd) {
  if (currentWs && currentWs.readyState === WebSocket.OPEN) {
    currentWs.send(JSON.stringify({ type: 'input', data: `/${cmd} ` }));
    if (currentTerm) currentTerm.focus();
  }
}

function sendPrompt() {
  const input = document.getElementById('prompt-input');
  const val = input.value.trim();
  if (!val || !currentWs || currentWs.readyState !== WebSocket.OPEN) return;
  currentWs.send(JSON.stringify({ type: 'input', data: val + '\n' }));
  input.value = '';
  if (currentTerm) currentTerm.focus();
}

document.getElementById('prompt-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendPrompt(); }
});

function updateStatusBadge(status) {
  const badge = document.getElementById('terminal-status-badge');
  if (!badge) return;
  badge.className = `terminal-status-badge ${status}`;
  badge.id = 'terminal-status-badge';
  badge.textContent = status;
}
