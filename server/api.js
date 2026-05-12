const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync, execFile } = require('child_process');
const sessionStore = require('./session-store');
const ptyManager = require('./pty-manager');
const templateStore = require('./template-store');

const router = express.Router();

// ── macOS native folder picker ───────────────────────────────────────────────

router.get('/pick-folder', (req, res) => {
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Select project folder:")'], (err, stdout) => {
      if (err) return res.status(400).json({ error: 'cancelled' });
      res.json({ path: stdout.trim() });
    });
  } else if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $f=New-Object System.Windows.Forms.FolderBrowserDialog; if($f.ShowDialog()-eq'OK'){$f.SelectedPath}else{exit 1}`;
    execFile('powershell.exe', ['-NonInteractive', '-Command', ps], (err, stdout) => {
      if (err) return res.status(400).json({ error: 'cancelled' });
      res.json({ path: stdout.trim() });
    });
  } else {
    res.status(501).json({ error: 'not supported' });
  }
});

// ── Directory browser (for Docker/non-macOS environments) ──────────────────────

router.get('/browse', (req, res) => {
  let dir = req.query.path || os.homedir();
  try {
    if (!fs.existsSync(dir)) dir = os.homedir();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ path: dir, dirs });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Session CRUD ─────────────────────────────────────────────────────────────

router.get('/sessions', (req, res) => {
  res.json(sessionStore.list());
});

router.post('/sessions', (req, res) => {
  const { dir, name, resume, existingPid } = req.body;
  if (!dir) return res.status(400).json({ error: 'dir is required' });
  if (!fs.existsSync(dir)) return res.status(400).json({ error: 'Directory does not exist' });

  // When adopting a discovered process, kill the original so it doesn't keep
  // running alongside the new session.
  if (existingPid) {
    try { process.kill(Number(existingPid), 'SIGTERM'); } catch (_) {}
  }

  const session = sessionStore.create(dir, name);
  const flags = resume ? ['--resume', resume] : [];
  try {
    const pid = ptyManager.spawn(session.id, dir, flags);
    sessionStore.update(session.id, { pid, status: 'running' });
    res.json(sessionStore.get(session.id));
  } catch (e) {
    sessionStore.update(session.id, { status: 'error' });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sessions/:id/close — kill PTY but keep session as 'exited' in sidebar
router.post('/sessions/:id/close', (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  ptyManager.kill(req.params.id);
  sessionStore.update(req.params.id, { status: 'exited' });
  res.json(sessionStore.get(req.params.id));
});

router.delete('/sessions/:id', (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  ptyManager.kill(req.params.id);
  ptyManager.clearBuffer(req.params.id);
  sessionStore.remove(req.params.id);
  res.json({ ok: true });
});

// POST /api/sessions/:id/restart — re-spawn PTY with --continue
router.post('/sessions/:id/restart', (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  if (ptyManager.isAlive(req.params.id)) return res.json(sessionStore.get(req.params.id));

  try {
    const pid = ptyManager.spawn(req.params.id, session.dir, ['--continue']);
    sessionStore.update(req.params.id, { pid, status: 'running' });
    res.json(sessionStore.get(req.params.id));
  } catch (e) {
    sessionStore.update(req.params.id, { status: 'error' });
    res.status(500).json({ error: e.message });
  }
});

// ── Discover running claude processes ────────────────────────────────────────

router.get('/discover', (req, res) => {
  let psOutput;
  try {
    psOutput = execSync('ps -ax -o pid,args 2>/dev/null', { encoding: 'utf8' });
  } catch (_) { return res.json([]); }

  const knownPids = new Set(sessionStore.list().map(s => s.pid).filter(Boolean));
  const discovered = [];

  for (const line of psOutput.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = parseInt(match[1]);
    const args = match[2];

    const firstWord = args.trim().split(/\s+/)[0];
    const isClaudeProcess = firstWord.endsWith('/claude') || firstWord === 'claude';
    if (!isClaudeProcess) continue;
    if (knownPids.has(pid)) continue;
    // Skip non-interactive subagent sessions
    if (args.includes('--output-format stream-json')) continue;

    const resumeMatch = args.match(/--resume\s+([a-f0-9-]{36})/);
    const claudeSessionId = resumeMatch ? resumeMatch[1] : null;

    let dir = null;
    if (claudeSessionId) {
      const projectsDir = path.join(os.homedir(), '.claude', 'projects');
      try {
        for (const projDir of fs.readdirSync(projectsDir)) {
          const jsonlPath = path.join(projectsDir, projDir, `${claudeSessionId}.jsonl`);
          if (fs.existsSync(jsonlPath)) {
            const firstLine = fs.readFileSync(jsonlPath, 'utf8').split('\n')[0];
            if (firstLine) {
              try { dir = JSON.parse(firstLine).cwd || null; } catch (_) {}
            }
            break;
          }
        }
      } catch (_) {}
    }

    if (!dir) {
      try {
        const lsofOut = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, { encoding: 'utf8' });
        const m = lsofOut.match(/^n(.+)$/m);
        if (m) dir = m[1];
      } catch (_) {}
    }

    discovered.push({ pid, dir, claudeSessionId });
  }

  res.json(discovered);
});

// ── Recent projects (all dirs that have JSONL history) ──────────────────────

router.get('/projects', (req, res) => {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return res.json([]);

  const projects = [];
  try {
    for (const projName of fs.readdirSync(projectsDir)) {
      const projPath = path.join(projectsDir, projName);
      let stat;
      try { stat = fs.statSync(projPath); } catch (_) { continue; }
      if (!stat.isDirectory()) continue;

      const jsonlFiles = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
      if (!jsonlFiles.length) continue;

      let dir = null;
      let lastActivity = 0;
      for (const f of jsonlFiles) {
        const filePath = path.join(projPath, f);
        const s = fs.statSync(filePath);
        if (s.mtimeMs > lastActivity) lastActivity = s.mtimeMs;
        if (!dir) {
          try {
            const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
            if (firstLine) dir = JSON.parse(firstLine).cwd || null;
          } catch (_) {}
        }
      }
      if (dir) projects.push({ dir, lastActivity, sessionCount: jsonlFiles.length });
    }
  } catch (_) {}

  projects.sort((a, b) => b.lastActivity - a.lastActivity);
  res.json(projects);
});

// ── Session history (past JSONL sessions for a directory) ────────────────────

router.get('/history', (req, res) => {
  const { dir } = req.query;
  if (!dir) return res.status(400).json({ error: 'dir required' });

  const encoded = dir.replace(/\/+$/, '').replace(/\//g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', encoded);
  if (!fs.existsSync(projectDir)) return res.json([]);

  try {
    const files = fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const stat = fs.statSync(path.join(projectDir, f));
        return { uuid: f.replace('.jsonl', ''), lastActivity: stat.mtime, size: stat.size };
      })
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Token usage stats ────────────────────────────────────────────────────────

function getSessionStats(dir, cb) {
  const encoded = dir.replace(/\/+$/, '').replace(/\//g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', encoded);
  const empty = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, turns: 0 };

  if (!fs.existsSync(projectDir)) return cb(null, empty);

  let latestFile = null, latestTime = 0;
  try {
    for (const f of fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))) {
      const stat = fs.statSync(path.join(projectDir, f));
      if (stat.mtimeMs > latestTime) { latestTime = stat.mtimeMs; latestFile = f; }
    }
  } catch (e) { return cb(e); }

  if (!latestFile) return cb(null, empty);

  const stats = { ...empty };
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(projectDir, latestFile)) });
  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      if (event.type === 'assistant' && event.message?.usage) {
        const u = event.message.usage;
        stats.input += u.input_tokens || 0;
        stats.output += u.output_tokens || 0;
        stats.cacheCreation += u.cache_creation_input_tokens || 0;
        stats.cacheRead += u.cache_read_input_tokens || 0;
        stats.turns++;
      }
    } catch (_) {}
  });
  rl.on('close', () => cb(null, stats));
  rl.on('error', cb);
}

router.get('/sessions/:id/stats', (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  getSessionStats(session.dir, (err, stats) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(stats);
  });
});

router.get('/stats', (req, res) => {
  const sessions = sessionStore.list();
  const total = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, turns: 0 };
  const results = [];
  let pending = sessions.length;
  if (pending === 0) return res.json({ sessions: [], total });

  for (const session of sessions) {
    getSessionStats(session.dir, (err, stats) => {
      if (!err && stats) {
        results.push({ id: session.id, ...stats });
        total.input += stats.input;
        total.output += stats.output;
        total.cacheCreation += stats.cacheCreation;
        total.cacheRead += stats.cacheRead;
        total.turns += stats.turns;
      }
      if (--pending === 0) res.json({ sessions: results, total });
    });
  }
});

// ── Auto-restart toggle ──────────────────────────────────────────────────────

router.patch('/sessions/:id', (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  const { autoRestart } = req.body;
  if (typeof autoRestart === 'boolean') sessionStore.update(req.params.id, { autoRestart });
  res.json(sessionStore.get(req.params.id));
});

// ── Conversation history ─────────────────────────────────────────────────────

router.get('/sessions/:id/conversation', (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });

  const encoded = session.dir.replace(/\/+$/, '').replace(/\//g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', encoded);
  if (!fs.existsSync(projectDir)) return res.json([]);

  let latestFile = null, latestTime = 0;
  try {
    for (const f of fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))) {
      const stat = fs.statSync(path.join(projectDir, f));
      if (stat.mtimeMs > latestTime) { latestTime = stat.mtimeMs; latestFile = f; }
    }
  } catch (e) { return res.status(500).json({ error: e.message }); }

  if (!latestFile) return res.json([]);

  const messages = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(projectDir, latestFile))
  });

  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      if (event.type === 'user') {
        const text = (event.message?.content || [])
          .filter(c => c.type === 'text').map(c => c.text).join('');
        if (text.trim()) {
          messages.push({ role: 'user', content: text, timestamp: event.timestamp });
        }
      } else if (event.type === 'assistant') {
        const content = event.message?.content || [];
        const text = content.filter(c => c.type === 'text').map(c => c.text).join('');
        const toolCalls = content
          .filter(c => c.type === 'tool_use')
          .map(c => ({ name: c.name, input: c.input }));
        if (text.trim() || toolCalls.length) {
          messages.push({ role: 'assistant', content: text, toolCalls, timestamp: event.timestamp });
        }
      }
    } catch (_) {}
  });

  rl.on('close', () => res.json(messages));
  rl.on('error', (e) => res.status(500).json({ error: e.message }));
});

// ── Prompt templates (global launchers) ─────────────────────────────────────

router.get('/templates', (req, res) => {
  res.json(templateStore.list());
});

router.post('/templates', (req, res) => {
  const { name, prompt, dir } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
  if (!dir?.trim()) return res.status(400).json({ error: 'dir is required' });
  if (!fs.existsSync(dir)) return res.status(400).json({ error: 'Directory does not exist' });
  res.status(201).json(templateStore.add({ name, prompt, dir }));
});

router.put('/templates/:id', (req, res) => {
  const { name, prompt, dir } = req.body || {};
  if (typeof dir === 'string' && dir.trim() && !fs.existsSync(dir.trim())) {
    return res.status(400).json({ error: 'Directory does not exist' });
  }
  const updated = templateStore.update(req.params.id, { name, prompt, dir });
  if (!updated) return res.status(404).json({ error: 'Template not found' });
  res.json(updated);
});

router.delete('/templates/:id', (req, res) => {
  templateStore.remove(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
