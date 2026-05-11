let sessions = [];
let activeSessionId = null;
const sessionStats = {};
let sessionFilter = '';

// Templates (global launchers) + palette state
let templates = [];
let paletteFilteredTemplates = [];
let paletteSelectedIndex = 0;
let editingTemplateId = null;
const pendingPromptBySession = new Map();
let sidebarNavIndex = -1;

// ── Theme ─────────────────────────────────────────────────────────────────────

function initTheme() {
  applyTheme(localStorage.getItem('theme') || 'dark');
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'light' ? '☾' : '☀';
  if (typeof applyTerminalTheme === 'function') applyTerminalTheme();
}

function toggleTheme() {
  const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  applyTheme(next);
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

// ── Session list ──────────────────────────────────────────────────────────────

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    sessions = await res.json();
    renderSidebar();
  } catch (e) {
    console.error('Failed to load sessions:', e);
  }
}

function getFilteredSessions() {
  return sessionFilter
    ? sessions.filter(s =>
        s.name.toLowerCase().includes(sessionFilter) ||
        s.dir.toLowerCase().includes(sessionFilter))
    : sessions.slice();
}

function focusSessionSearch() {
  const input = document.getElementById('session-search');
  input.focus();
  input.select();
  const visible = getFilteredSessions();
  sidebarNavIndex = visible.findIndex(s => s.id === activeSessionId);
  if (sidebarNavIndex === -1 && visible.length) sidebarNavIndex = 0;
}

function filterSessions(value) {
  sessionFilter = value.toLowerCase();
  sidebarNavIndex = -1;
  renderSidebar();
}

function renderSidebar() {
  const list = document.getElementById('session-list');
  list.innerHTML = '';

  const visible = sessionFilter
    ? sessions.filter(s =>
        s.name.toLowerCase().includes(sessionFilter) ||
        s.dir.toLowerCase().includes(sessionFilter))
    : sessions;

  for (const session of visible) {
    const item = document.createElement('div');
    item.className = 'session-item' + (session.id === activeSessionId ? ' active' : '');
    item.dataset.id = session.id;

    const dot = document.createElement('div');
    dot.className = `status-dot ${session.status}`;

    const info = document.createElement('div');
    info.className = 'session-info';

    const name = document.createElement('div');
    name.className = 'session-name';
    name.textContent = session.name;
    name.title = session.dir;
    info.appendChild(name);

    const stats = sessionStats[session.id];
    if (stats && stats.turns > 0) {
      const tokensEl = document.createElement('div');
      tokensEl.className = 'session-tokens';
      tokensEl.textContent = `↑${fmtTokens(stats.input)} ↓${fmtTokens(stats.output)}`;
      info.appendChild(tokensEl);
    }

    const actions = document.createElement('div');
    actions.className = 'session-actions';

    // Auto-restart toggle (always present)
    const arBtn = document.createElement('div');
    const arOn = !!session.autoRestart;
    arBtn.className = `session-action-btn session-auto-restart${arOn ? ' on' : ''}`;
    arBtn.textContent = '↺';
    arBtn.title = arOn ? 'Auto-restart: ON (click to disable)' : 'Auto-restart: OFF (click to enable)';
    arBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleAutoRestart(session.id, !arOn); });
    actions.appendChild(arBtn);

    if (session.status === 'exited') {
      const restartBtn = document.createElement('div');
      restartBtn.className = 'session-action-btn session-restart';
      restartBtn.textContent = '↻';
      restartBtn.title = 'Restart session';
      restartBtn.addEventListener('click', (e) => { e.stopPropagation(); restartSession(session.id); });
      actions.appendChild(restartBtn);

      // On exited sessions × removes it entirely
      const removeBtn = document.createElement('div');
      removeBtn.className = 'session-action-btn session-close';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove session';
      removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeSession(session.id); });
      actions.appendChild(removeBtn);
    } else {
      // On running/starting sessions × stops the PTY but keeps session as exited
      const stopBtn = document.createElement('div');
      stopBtn.className = 'session-action-btn session-close';
      stopBtn.textContent = '×';
      stopBtn.title = 'Stop session (keeps history)';
      stopBtn.addEventListener('click', (e) => { e.stopPropagation(); stopSession(session.id); });
      actions.appendChild(stopBtn);
    }

    item.appendChild(dot);
    item.appendChild(info);
    item.appendChild(actions);
    item.addEventListener('click', () => selectSession(session.id));
    list.appendChild(item);
  }
}

function updateSidebarStatus(id, status) {
  const session = sessions.find(s => s.id === id);
  if (session) { session.status = status; renderSidebar(); }
}

function selectSession(id) {
  activeSessionId = id;
  const session = sessions.find(s => s.id === id);
  if (session) { renderSidebar(); openTerminal(session); }
}

// Stop PTY but keep session visible as 'exited'
async function stopSession(id) {
  try {
    const res = await fetch(`/api/sessions/${id}/close`, { method: 'POST' });
    if (res.ok) {
      const updated = await res.json();
      const idx = sessions.findIndex(s => s.id === id);
      if (idx >= 0) sessions[idx] = updated;
      renderSidebar();
    }
  } catch (_) {}
}

// Remove session entirely from store and sidebar
async function removeSession(id) {
  try { await fetch(`/api/sessions/${id}`, { method: 'DELETE' }); } catch (_) {}
  sessions = sessions.filter(s => s.id !== id);
  delete sessionStats[id];
  pendingPromptBySession.delete(id);
  if (activeSessionId === id) {
    activeSessionId = null;
    document.getElementById('terminal-header').style.display = 'none';
    document.getElementById('slash-toolbar').style.display = 'none';
    document.getElementById('prompt-bar').style.display = 'none';
    closeConversationPanel();
    document.getElementById('terminal-container').innerHTML =
      '<div class="empty-state" id="empty-state"><div class="icon">⌗</div><p>No session selected</p><button class="btn-primary" onclick="openNewModal()">+ New Session</button></div>';
  }
  renderSidebar();
}

async function toggleAutoRestart(id, enable) {
  try {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoRestart: enable }),
    });
    if (res.ok) {
      const updated = await res.json();
      const idx = sessions.findIndex(s => s.id === id);
      if (idx >= 0) sessions[idx] = updated;
      renderSidebar();
    }
  } catch (_) {}
}

async function restartSession(id) {
  const res = await fetch(`/api/sessions/${id}/restart`, { method: 'POST' });
  if (res.ok) {
    const updated = await res.json();
    const idx = sessions.findIndex(s => s.id === id);
    if (idx >= 0) sessions[idx] = updated;
    renderSidebar();
    selectSession(id);
  }
}

// ── Discover running processes ────────────────────────────────────────────────

async function discoverSessions() {
  try {
    const res = await fetch('/api/discover');
    const discovered = await res.json();
    renderDiscovered(discovered);
  } catch (_) {}
}

function renderDiscovered(discovered) {
  const section = document.getElementById('discovered-section');
  const list = document.getElementById('discovered-list');

  if (!discovered.length) { section.style.display = 'none'; return; }

  section.style.display = 'block';
  list.innerHTML = '';

  for (const proc of discovered) {
    const dirName = proc.dir ? proc.dir.split('/').pop() : null;
    const item = document.createElement('div');
    item.className = 'discovered-item';

    const icon = document.createElement('span');
    icon.className = 'discovered-icon';
    icon.textContent = '◈';

    const info = document.createElement('div');
    info.className = 'discovered-info';
    info.innerHTML = `<div class="discovered-name">${dirName || 'Unknown dir'}</div><div class="discovered-pid">PID ${proc.pid}</div>`;

    const btn = document.createElement('button');
    btn.className = 'btn-import';
    btn.textContent = 'Open';
    btn.onclick = () => importProcess(proc.pid, proc.dir, proc.claudeSessionId);

    item.appendChild(icon);
    item.appendChild(info);
    item.appendChild(btn);
    list.appendChild(item);
  }
}

async function importProcess(pid, dir, claudeSessionId) {
  if (!dir) { alert('Cannot determine working directory for this process'); return; }
  const body = { dir, name: dir.split('/').pop() };
  if (claudeSessionId) body.resume = claudeSessionId;
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const session = await res.json();
    sessions.push(session);
    renderSidebar();
    selectSession(session.id);
  }
}

// ── Token stats ───────────────────────────────────────────────────────────────

async function refreshStats() {
  if (sessions.length === 0) return;
  try {
    const res = await fetch('/api/stats');
    const { sessions: statsArr, total } = await res.json();

    for (const s of statsArr) sessionStats[s.id] = s;

    // Update per-session token display without full re-render
    for (const s of statsArr) {
      if (!s.turns) continue;
      const item = document.querySelector(`.session-item[data-id="${s.id}"]`);
      if (!item) continue;
      let tokensEl = item.querySelector('.session-tokens');
      if (!tokensEl) {
        tokensEl = document.createElement('div');
        tokensEl.className = 'session-tokens';
        const info = item.querySelector('.session-info');
        if (info) info.appendChild(tokensEl);
      }
      tokensEl.textContent = `↑${fmtTokens(s.input)} ↓${fmtTokens(s.output)}`;
    }

    // Update global header
    const globalStats = document.getElementById('global-stats');
    if (globalStats && total.turns > 0) {
      globalStats.textContent = `↑ ${fmtTokens(total.input)}  ↓ ${fmtTokens(total.output)} tokens`;
    }
  } catch (_) {}
}

// ── Modal ─────────────────────────────────────────────────────────────────────

async function pickFolder() {
  const res = await fetch('/api/pick-folder');
  if (!res.ok) return;
  const { path } = await res.json();
  document.getElementById('input-dir').value = path;
  document.getElementById('input-name').focus();
  document.getElementById('history-panel').style.display = 'none';
  loadHistory(); // auto-show history for the picked folder
}

function openNewModal() {
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('history-panel').style.display = 'none';
  setTimeout(() => document.getElementById('input-dir').focus(), 50);
}

function closeNewModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('input-dir').value = '';
  document.getElementById('input-name').value = '';
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('history-panel').style.display = 'none';
}

async function createSession() {
  const dir = document.getElementById('input-dir').value.trim();
  const name = document.getElementById('input-name').value.trim();
  const errorMsg = document.getElementById('error-msg');

  if (!dir) { errorMsg.textContent = 'Directory path is required'; errorMsg.style.display = 'block'; return; }
  errorMsg.style.display = 'none';

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, name: name || undefined }),
    });
    if (!res.ok) {
      const err = await res.json();
      errorMsg.textContent = err.error || 'Failed to create session';
      errorMsg.style.display = 'block';
      return;
    }
    const session = await res.json();
    sessions.push(session);
    closeNewModal();
    selectSession(session.id);
  } catch (e) {
    errorMsg.textContent = 'Network error — is the server running?';
    errorMsg.style.display = 'block';
  }
}

// ── Session history ───────────────────────────────────────────────────────────

async function loadHistory() {
  const dir = document.getElementById('input-dir').value.trim();
  const panel = document.getElementById('history-panel');
  const list = document.getElementById('history-list');

  if (!dir) {
    // No directory yet — show all recent projects so user can pick one
    try {
      const res = await fetch('/api/projects');
      const projects = await res.json();
      if (!projects.length) {
        list.innerHTML = '<div class="history-empty">No recent projects found</div>';
      } else {
        list.innerHTML = '';
        for (const p of projects) {
          const item = document.createElement('div');
          item.className = 'history-item';
          const dirName = p.dir.split('/').pop() || p.dir;
          const date = new Date(p.lastActivity).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const dateEl = document.createElement('span');
          dateEl.className = 'history-date';
          dateEl.textContent = `${dirName} (${p.sessionCount})`;
          const sizeEl = document.createElement('span');
          sizeEl.className = 'history-size';
          sizeEl.textContent = date;
          item.appendChild(dateEl);
          item.appendChild(sizeEl);
          item.title = p.dir;
          item.addEventListener('click', () => {
            document.getElementById('input-dir').value = p.dir;
            loadHistory();
          });
          list.appendChild(item);
        }
      }
      panel.style.display = 'block';
    } catch (_) {}
    return;
  }

  const res = await fetch(`/api/history?dir=${encodeURIComponent(dir)}`);
  const history = await res.json();

  if (!history.length) {
    list.innerHTML = '<div class="history-empty">No past sessions found for this directory</div>';
  } else {
    list.innerHTML = '';
    for (const entry of history) {
      const item = document.createElement('div');
      item.className = 'history-item';
      const date = new Date(entry.lastActivity).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const size = entry.size > 1024 * 1024 ? (entry.size / 1024 / 1024).toFixed(1) + ' MB' : Math.round(entry.size / 1024) + ' KB';
      item.innerHTML = `<span class="history-date">${date}</span><span class="history-size">${size}</span>`;
      item.title = `Session ID: ${entry.uuid}`;
      item.addEventListener('click', () => resumeSession(dir, entry.uuid));
      list.appendChild(item);
    }
  }
  panel.style.display = 'block';
}

async function resumeSession(dir, uuid) {
  const name = dir.split('/').pop();
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir, name, resume: uuid }),
  });
  if (res.ok) {
    const session = await res.json();
    sessions.push(session);
    closeNewModal();
    selectSession(session.id);
  }
}

// ── Conversation viewer ───────────────────────────────────────────────────────

let conversationOpen = false;

function closeConversationPanel() {
  conversationOpen = false;
  document.getElementById('conversation-panel').style.display = 'none';
  const btn = document.getElementById('chat-toggle-btn');
  if (btn) btn.classList.remove('active');
}

async function toggleConversation() {
  if (conversationOpen) { closeConversationPanel(); return; }
  if (!activeSessionId) return;

  conversationOpen = true;
  const panel = document.getElementById('conversation-panel');
  panel.style.display = 'flex';
  const btn = document.getElementById('chat-toggle-btn');
  if (btn) btn.classList.add('active');

  const msgs = document.getElementById('conv-messages');
  msgs.innerHTML = '<div class="conv-loading">Loading…</div>';

  try {
    const res = await fetch(`/api/sessions/${activeSessionId}/conversation`);
    const messages = await res.json();
    renderConversation(messages);
  } catch (_) {
    msgs.innerHTML = '<div class="conv-empty">Failed to load conversation</div>';
  }
}

function renderConversation(messages) {
  const msgs = document.getElementById('conv-messages');
  msgs.innerHTML = '';

  if (!messages.length) {
    msgs.innerHTML = '<div class="conv-empty">No conversation yet</div>';
    return;
  }

  for (const msg of messages) {
    const bubble = document.createElement('div');
    bubble.className = `conv-bubble ${msg.role}`;

    if (msg.content) {
      const text = document.createElement('div');
      text.className = 'conv-text';
      text.textContent = msg.content;
      bubble.appendChild(text);
    }

    for (const tc of (msg.toolCalls || [])) {
      const details = document.createElement('details');
      details.className = 'conv-tool-call';
      const summary = document.createElement('summary');
      summary.textContent = tc.name;
      details.appendChild(summary);
      const pre = document.createElement('pre');
      try { pre.textContent = JSON.stringify(tc.input, null, 2); } catch (_) { pre.textContent = String(tc.input); }
      details.appendChild(pre);
      bubble.appendChild(details);
    }

    const ts = document.createElement('div');
    ts.className = 'conv-timestamp';
    ts.textContent = new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    bubble.appendChild(ts);

    msgs.appendChild(bubble);
  }

  msgs.scrollTop = msgs.scrollHeight;
}

// ── Template launchers (Cmd/Ctrl+K palette) ──────────────────────────────────

async function loadAllTemplates() {
  try {
    const res = await fetch('/api/templates');
    templates = res.ok ? await res.json() : [];
  } catch (_) { templates = []; }
}

function openPalette() {
  const overlay = document.getElementById('palette-overlay');
  const search = document.getElementById('palette-search');
  search.value = '';
  paletteSelectedIndex = 0;
  renderPalette('');
  overlay.classList.add('open');
  setTimeout(() => search.focus(), 30);
}

function closePalette() {
  document.getElementById('palette-overlay').classList.remove('open');
  document.getElementById('palette-search').blur();
}

function isPaletteOpen() {
  return document.getElementById('palette-overlay').classList.contains('open');
}

function filterTemplates(text) {
  const q = text.trim().toLowerCase();
  if (!q) return templates.slice();
  return templates.filter(t =>
    (t.name || '').toLowerCase().includes(q) ||
    (t.dir || '').toLowerCase().includes(q) ||
    (t.prompt || '').toLowerCase().includes(q)
  );
}

function renderPalette(filterText) {
  const list = document.getElementById('palette-list');
  paletteFilteredTemplates = filterTemplates(filterText);
  if (paletteSelectedIndex >= paletteFilteredTemplates.length) {
    paletteSelectedIndex = Math.max(0, paletteFilteredTemplates.length - 1);
  }

  list.innerHTML = '';
  if (!paletteFilteredTemplates.length) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.textContent = templates.length
      ? 'No templates match your search.'
      : 'No templates yet — click "+ New template" below to create one.';
    list.appendChild(empty);
    return;
  }

  paletteFilteredTemplates.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'palette-row' + (i === paletteSelectedIndex ? ' selected' : '');
    row.dataset.id = t.id;
    row.addEventListener('click', () => launchTemplate(t.id));
    row.addEventListener('mouseenter', () => {
      paletteSelectedIndex = i;
      updatePaletteSelection();
    });

    const info = document.createElement('div');
    info.className = 'palette-row-info';
    const name = document.createElement('div');
    name.className = 'palette-name';
    name.textContent = t.name;
    const meta = document.createElement('div');
    meta.className = 'palette-meta';
    meta.textContent = t.dir;
    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'palette-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'palette-action';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit template';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTemplateEditor(t.id); });
    const delBtn = document.createElement('button');
    delBtn.className = 'palette-action delete';
    delBtn.textContent = '×';
    delBtn.title = 'Delete template';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTemplateById(t.id); });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    row.appendChild(info);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

function updatePaletteSelection() {
  const rows = document.querySelectorAll('#palette-list .palette-row');
  rows.forEach((row, i) => row.classList.toggle('selected', i === paletteSelectedIndex));
  const selected = rows[paletteSelectedIndex];
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

async function launchTemplate(id) {
  const t = templates.find(x => x.id === id);
  if (!t) return;
  closePalette();

  // Reuse a running session in the same dir if one exists
  const running = sessions.find(s => s.dir === t.dir && s.status === 'running');
  if (running) {
    if (activeSessionId !== running.id) selectSession(running.id);
    sendPromptToActiveSession(t.prompt);
    return;
  }

  // Otherwise spawn a new session and queue the prompt for after first output
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: t.dir, name: t.name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Could not start session: ${err.error || res.statusText}`);
      return;
    }
    const session = await res.json();
    sessions.push(session);
    pendingPromptBySession.set(session.id, t.prompt);
    selectSession(session.id);
  } catch (e) {
    alert(`Network error: ${e.message}`);
  }
}

function sendPromptToActiveSession(prompt, attempt = 0) {
  if (typeof currentWs !== 'undefined' && currentWs && currentWs.readyState === WebSocket.OPEN) {
    currentWs.send(JSON.stringify({ type: 'input', data: prompt + '\n' }));
    return;
  }
  if (attempt > 10) return;
  setTimeout(() => sendPromptToActiveSession(prompt, attempt + 1), 50);
}

// ── Template editor (create / edit) ──────────────────────────────────────────

function openTemplateEditor(id) {
  editingTemplateId = id || null;
  const title = document.getElementById('te-title');
  const nameEl = document.getElementById('te-name');
  const dirEl = document.getElementById('te-dir');
  const promptEl = document.getElementById('te-prompt');
  const errEl = document.getElementById('te-error');
  errEl.style.display = 'none';

  if (id) {
    const t = templates.find(x => x.id === id);
    title.textContent = 'Edit Template';
    nameEl.value = t?.name || '';
    dirEl.value = t?.dir || '';
    promptEl.value = t?.prompt || '';
  } else {
    title.textContent = 'New Template';
    nameEl.value = '';
    dirEl.value = '';
    promptEl.value = '';
  }
  document.getElementById('template-editor-overlay').classList.add('open');
  setTimeout(() => nameEl.focus(), 30);
}

function closeTemplateEditor() {
  document.getElementById('template-editor-overlay').classList.remove('open');
  editingTemplateId = null;
}

function isTemplateEditorOpen() {
  return document.getElementById('template-editor-overlay').classList.contains('open');
}

async function pickTemplateDir() {
  try {
    const res = await fetch('/api/pick-folder');
    if (!res.ok) return;
    const { path } = await res.json();
    document.getElementById('te-dir').value = path;
  } catch (_) {}
}

async function saveTemplate() {
  const name = document.getElementById('te-name').value.trim();
  const dir = document.getElementById('te-dir').value.trim();
  const prompt = document.getElementById('te-prompt').value.trim();
  const errEl = document.getElementById('te-error');

  if (!name) { errEl.textContent = 'Name is required'; errEl.style.display = 'block'; return; }
  if (!dir) { errEl.textContent = 'Directory is required'; errEl.style.display = 'block'; return; }
  if (!prompt) { errEl.textContent = 'Prompt is required'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  try {
    let saved;
    if (editingTemplateId) {
      const res = await fetch(`/api/templates/${editingTemplateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, dir, prompt }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        errEl.textContent = err.error || 'Failed to save'; errEl.style.display = 'block';
        return;
      }
      saved = await res.json();
      const idx = templates.findIndex(t => t.id === editingTemplateId);
      if (idx >= 0) templates[idx] = saved;
    } else {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, dir, prompt }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        errEl.textContent = err.error || 'Failed to save'; errEl.style.display = 'block';
        return;
      }
      saved = await res.json();
      templates.push(saved);
    }
    closeTemplateEditor();
    if (isPaletteOpen()) renderPalette(document.getElementById('palette-search').value);
  } catch (e) {
    errEl.textContent = 'Network error'; errEl.style.display = 'block';
  }
}

async function deleteTemplateById(id) {
  try {
    await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    templates = templates.filter(t => t.id !== id);
    if (isPaletteOpen()) renderPalette(document.getElementById('palette-search').value);
  } catch (_) {}
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeNewModal();
});

document.getElementById('palette-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('palette-overlay')) closePalette();
});

document.getElementById('template-editor-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('template-editor-overlay')) closeTemplateEditor();
});

document.getElementById('palette-search').addEventListener('input', (e) => {
  paletteSelectedIndex = 0;
  renderPalette(e.target.value);
});

document.addEventListener('keydown', (e) => {
  // Alt+[ / Alt+] — cycle sessions (prev/next)
  if (e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
    e.preventDefault();
    const visible = getFilteredSessions();
    if (!visible.length) return;
    const idx = visible.findIndex(s => s.id === activeSessionId);
    const target = e.code === 'BracketLeft'
      ? visible[idx > 0 ? idx - 1 : visible.length - 1]
      : visible[idx < visible.length - 1 ? idx + 1 : 0];
    if (target) selectSession(target.id);
    return;
  }
  // Cmd/Ctrl+/ — focus session search
  if ((e.metaKey || e.ctrlKey) && e.key === '/') {
    e.preventDefault();
    focusSessionSearch();
    return;
  }
  // Cmd/Ctrl+K toggles palette (don't trigger when typing in a different input that wants K)
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (isPaletteOpen()) closePalette(); else openPalette();
    return;
  }

  if (e.key === 'Escape') {
    if (isTemplateEditorOpen()) { closeTemplateEditor(); return; }
    if (isPaletteOpen()) { closePalette(); return; }
    closeNewModal();
    return;
  }

  if (isPaletteOpen() && !isTemplateEditorOpen()) {
    if (e.key === 'ArrowDown') {
      paletteSelectedIndex = Math.min(paletteSelectedIndex + 1, paletteFilteredTemplates.length - 1);
      updatePaletteSelection();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      paletteSelectedIndex = Math.max(paletteSelectedIndex - 1, 0);
      updatePaletteSelection();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const t = paletteFilteredTemplates[paletteSelectedIndex];
      if (t) launchTemplate(t.id);
      e.preventDefault();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && (e.metaKey || e.ctrlKey || e.shiftKey)) {
      const t = paletteFilteredTemplates[paletteSelectedIndex];
      if (t) deleteTemplateById(t.id);
      e.preventDefault();
    }
  }
});

document.getElementById('session-search').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Escape') return;
  e.preventDefault();
  if (e.key === 'Enter' || e.key === 'Escape') {
    document.getElementById('session-search').blur();
    if (typeof currentTerm !== 'undefined' && currentTerm) currentTerm.focus();
    return;
  }
  const visible = getFilteredSessions();
  if (!visible.length) return;
  const dir = e.key === 'ArrowDown' ? 1 : -1;
  sidebarNavIndex = Math.max(0, Math.min(visible.length - 1, sidebarNavIndex + dir));
  const target = visible[sidebarNavIndex];
  if (target) {
    selectSession(target.id);
    setTimeout(() => {
      const el = document.querySelector(`.session-item[data-id="${target.id}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }, 0);
  }
});

document.getElementById('input-dir').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createSession();
});

document.getElementById('input-dir').addEventListener('blur', () => {
  loadHistory();
});

document.getElementById('input-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createSession();
});

// ── Init ──────────────────────────────────────────────────────────────────────

initTheme();
loadSessions();
loadAllTemplates();
setInterval(refreshStats, 10000);
setInterval(discoverSessions, 15000);
discoverSessions();
setTimeout(refreshStats, 2000);
