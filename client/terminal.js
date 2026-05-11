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
  if (currentTerm) currentTerm.options.theme = getTerminalTheme();
}

let currentTerm = null;
let currentWs = null;
let currentSessionId = null;
let reconnectTimer = null;

function openTerminal(session) {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (currentTerm) { currentTerm.dispose(); currentTerm = null; }
  if (currentWs) { currentWs.close(); currentWs = null; }

  currentSessionId = session.id;

  const container = document.getElementById('terminal-container');
  container.innerHTML = '';

  const header = document.getElementById('terminal-header');
  header.style.display = 'flex';
  document.getElementById('slash-toolbar').style.display = 'flex';
  document.getElementById('terminal-dir').textContent = `${session.name}  —  ${session.dir}`;
  updateStatusBadge(session.status);

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
  term.open(container);

  setTimeout(() => fitAddon.fit(), 0);

  currentTerm = term;

  term.onData((data) => {
    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify({ type: 'input', data }));
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  });
  resizeObserver.observe(container);

  connectWs(session, term, fitAddon);
}

function connectWs(session, term, fitAddon) {
  if (currentSessionId !== session.id) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/${session.id}`);
  currentWs = ws;
  let firstOutputReceived = false;

  ws.onopen = () => {
    fitAddon.fit();
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        term.write(msg.data);
        if (!firstOutputReceived) {
          firstOutputReceived = true;
          // After Claude's TUI has rendered its first frame, inject any pending prompt
          // (e.g. queued by a template launch). 400ms gives the prompt input time to mount.
          if (typeof pendingPromptBySession !== 'undefined' && pendingPromptBySession.has(session.id)) {
            const queued = pendingPromptBySession.get(session.id);
            pendingPromptBySession.delete(session.id);
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data: queued + '\n' }));
              }
            }, 400);
          }
        }
      } else if (msg.type === 'exit') {
        updateStatusBadge('exited');
        updateSidebarStatus(session.id, 'exited');
      } else if (msg.type === 'restarted') {
        updateStatusBadge('running');
        updateSidebarStatus(session.id, 'running');
      }
    } catch (_) {}
  };

  ws.onclose = () => {
    if (currentSessionId !== session.id) return;
    reconnectTimer = setTimeout(() => connectWs(session, term, fitAddon), 2000);
  };

  ws.onerror = () => ws.close();
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
