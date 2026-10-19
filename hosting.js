'use strict';
// Local Minecraft server hosting for Ember (runs in the main process).
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const MANIFESTS = [
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'
];
const ID_RE = /^[a-f0-9-]{36}$/;
const VER_RE = /^[0-9A-Za-z._-]{1,32}$/;
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function parseJavaMajor(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text || '');
  if (!m) return null;
  const first = Number(m[1]);
  return first === 1 ? Number(m[2]) : first;
}

function escProp(v) {
  return String(v).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\')
    .replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function mergeProps(existing, updates) {
  const lines = existing ? existing.split(/\r?\n/) : [];
  const left = { ...updates };
  const out = lines.map((line) => {
    const m = /^([^#!=\s][^=]*)=/.exec(line);
    if (m && Object.prototype.hasOwnProperty.call(left, m[1].trim())) {
      const k = m[1].trim();
      const v = left[k];
      delete left[k];
      return `${k}=${v}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of Object.entries(left)) out.push(`${k}=${v}`);
  return out.join('\n').replace(/\n*$/, '\n');
}

const int = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
const text = (v, max, label, required) => {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  if (required && !s) throw new Error(`${label} is required.`);
  if (s.length > max) throw new Error(`${label} is too long.`);
  return s;
};

function validate(input, partial) {
  const o = {};
  const has = (k) => !partial || input[k] !== undefined;
  if (has('name')) o.name = text(input.name, 40, 'Name', true);
  if (has('port')) o.port = int(input.port, 1024, 65535, 'Port');
  if (has('maxPlayers')) o.maxPlayers = int(input.maxPlayers, 1, 200, 'Max players');
  if (has('ram')) o.ram = int(input.ram, 512, 32768, 'Memory (MB)');
  if (has('motd')) o.motd = text(input.motd, 100, 'MOTD', false);
  if (has('whitelist')) o.whitelist = !!input.whitelist;
  if (has('publicAddress')) o.publicAddress = text(input.publicAddress, 120, 'Address', false);
  if (has('eula')) o.eula = !!input.eula;
  return o;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  return res.json();
}
async function getManifest() {
  let lastErr;
  for (const u of MANIFESTS) {
    try { return await getJson(u); } catch (e) { lastErr = e; }
  }
  throw new Error('Could not reach Mojang to get the version list. Check your internet connection. ' + (lastErr ? lastErr.message : ''));
}


// ---- playit.gg tunnel helpers ----
const CLAIM_RE = /https:\/\/playit\.gg\/claim\/[A-Za-z0-9_-]+(?:\?[A-Za-z0-9_=&.-]*)?/;
const ADDR_RE = /\b((?:[a-z0-9-]+\.)+(?:ply\.gg|joinmc\.link|playit\.gg))(?::(\d{2,5}))?\b/gi;
const INFRA = new Set(['api', 'www', 'docs', 'control', 'playit']);

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r/g, '');
}

function scanPlayitOutput(line) {
  const out = {};
  const c = CLAIM_RE.exec(line);
  if (c) out.claim = c[0];
  ADDR_RE.lastIndex = 0;
  let m;
  while ((m = ADDR_RE.exec(line))) {
    const host = m[1].toLowerCase();
    const first = host.split('.')[0];
    const own = /(ply\.gg|joinmc\.link)$/.test(host);
    if (own || (m[2] && !INFRA.has(first))) {
      out.address = m[2] ? `${host}:${m[2]}` : host;
      break;
    }
  }
  return out;
}

async function findPlayitAsset() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Automatic tunnel setup works on 64-bit Windows only. Use the guide to set up playit yourself.');
  }
  const res = await fetch('https://api.github.com/repos/playit-cloud/playit-agent/releases?per_page=15', {
    headers: { 'User-Agent': 'Ember-Launcher', Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`Could not look up playit (HTTP ${res.status}).`);
  for (const r of await res.json()) {
    if (r.draft || r.prerelease) continue;
    const exes = (r.assets || []).filter((a) => /^playit-windows-x86_64.*\.exe$/.test(a.name));
    const a = exes.find((x) => x.name.includes('signed')) || exes[0];
    if (a && a.browser_download_url.startsWith('https://github.com/playit-cloud/playit-agent/')) return a.browser_download_url;
  }
  throw new Error('Could not find the playit program for Windows. Use the guide to set it up yourself.');
}


// ---- Java download helpers (Eclipse Temurin via Adoptium) ----
const run = (cmd, args, opts) => new Promise((resolve, reject) => {
  execFile(cmd, args, opts || {}, (err) => (err ? reject(err) : resolve()));
});

async function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const attempts = [
    () => run('tar', ['-xf', zip, '-C', dest], { windowsHide: true }),
    () => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:EMBER_ZIP -DestinationPath $env:EMBER_DEST -Force'],
      { env: { ...process.env, EMBER_ZIP: zip, EMBER_DEST: dest }, windowsHide: true }),
    () => run('unzip', ['-q', '-o', zip, '-d', dest])
  ];
  let last;
  for (const go of attempts) {
    try { await go(); return; } catch (e) { last = e; }
  }
  throw new Error('Could not unpack Java: ' + (last && last.message));
}

function findJavaBin(dir, depth = 0) {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const direct = path.join(dir, 'bin', exe);
  if (fs.existsSync(direct)) return direct;
  if (depth >= 2 || !fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const hit = findJavaBin(path.join(dir, entry.name), depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

async function javaDownloadInfo(major) {
  const n = Number(major);
  if (!Number.isInteger(n) || n < 8 || n > 99) throw new Error('Unexpected Java version.');
  try {
    const res = await fetch(`https://api.adoptium.net/v3/assets/latest/${n}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse`, { headers: { 'User-Agent': 'Ember-Launcher' } });
    if (res.ok) {
      const pkg = (await res.json())?.[0]?.binary?.package;
      if (pkg && typeof pkg.link === 'string' && pkg.link.startsWith('https://') && /\.zip$/.test(pkg.link)) {
        return { url: pkg.link, sha256: /^[a-f0-9]{64}$/i.test(pkg.checksum || '') ? pkg.checksum.toLowerCase() : null };
      }
    }
  } catch { /* fall back below */ }
  return { url: `https://api.adoptium.net/v3/binary/latest/${n}/ga/windows/x64/jre/hotspot/normal/eclipse`, sha256: null };
}

function register({ app, ipcMain, shell, dialog, getWindow }) {
  const root = () => path.join(app.getPath('userData'), 'servers');
  const listFile = () => path.join(app.getPath('userData'), 'hosted.json');
  const running = new Map();

  const readList = () => {
    try { const a = JSON.parse(fs.readFileSync(listFile(), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; }
  };
  const writeList = (a) => {
    fs.mkdirSync(path.dirname(listFile()), { recursive: true });
    fs.writeFileSync(listFile() + '.tmp', JSON.stringify(a, null, 2));
    fs.renameSync(listFile() + '.tmp', listFile());
  };
  const dirOf = (id) => {
    if (!ID_RE.test(String(id))) throw new Error('Bad server id.');
    return path.join(root(), id);
  };
  const find = (id) => {
    const c = readList().find((x) => x.id === id);
    if (!c) throw new Error('Server not found.');
    return c;
  };
  const send = (ch, payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
  };
  const log = (id, line) => send('host:log', { id, line });
  const withRunning = () => readList().map((c) => ({ ...c, running: running.has(c.id) }));

  const applyFiles = (c) => {
    const dir = dirOf(c.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'eula.txt'), `eula=${c.eula ? 'true' : 'false'}\n`);
    const pf = path.join(dir, 'server.properties');
    const existing = fs.existsSync(pf) ? fs.readFileSync(pf, 'utf8') : '';
    fs.writeFileSync(pf, mergeProps(existing, {
      'server-port': c.port,
      'max-players': c.maxPlayers,
      'motd': escProp(c.motd),
      'online-mode': 'true',
      'white-list': c.whitelist,
      'enforce-whitelist': c.whitelist
    }));
  };

  ipcMain.handle('host:versions', async () => {
    const m = await getManifest();
    const releases = m.versions.filter((v) => v.type === 'release').map((v) => v.id).slice(0, 60);
    return { latest: m.latest.release, releases };
  });

  ipcMain.handle('host:list', () => withRunning());

  ipcMain.handle('host:create', async (_e, input) => {
    const v = validate(input, false);
    const version = String(input.version || '');
    if (!VER_RE.test(version)) throw new Error('Pick a Minecraft version.');
    if (!v.eula) throw new Error('You need to accept the Minecraft EULA to run a server.');
    const m = await getManifest();
    const entry = m.versions.find((x) => x.id === version);
    if (!entry) throw new Error('That version was not found.');
    const vj = await getJson(entry.url);
    const dl = vj.downloads && vj.downloads.server;
    if (!dl) throw new Error('This version has no downloadable server.');
    const id = crypto.randomUUID();
    const dir = dirOf(id);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const tmp = path.join(dir, 'server.jar.tmp');
      const res = await fetch(dl.url);
      if (!res.ok || !res.body) throw new Error(`Server download failed (HTTP ${res.status}).`);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      const sha = crypto.createHash('sha1').update(fs.readFileSync(tmp)).digest('hex');
      if (dl.sha1 && sha !== dl.sha1) throw new Error('The downloaded server file did not match its checksum. Try again.');
      fs.renameSync(tmp, path.join(dir, 'server.jar'));
      const cfg = { id, version, javaMajor: (vj.javaVersion && vj.javaVersion.majorVersion) || 8, createdAt: Date.now(), ...v };
      applyFiles(cfg);
      writeList([...readList(), cfg]);
      return cfg;
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  });

  ipcMain.handle('host:update', (_e, id, input) => {
    const cfg = { ...find(id), ...validate(input || {}, true) };
    applyFiles(cfg);
    writeList(readList().map((x) => (x.id === id ? cfg : x)));
    return cfg;
  });

  ipcMain.handle('host:remove', (_e, id) => {
    if (running.has(id)) throw new Error('Stop the server before deleting it.');
    const dir = dirOf(id);
    find(id);
    fs.rmSync(dir, { recursive: true, force: true });
    writeList(readList().filter((x) => x.id !== id));
    return true;
  });

  const javaMajor = () => new Promise((resolve, reject) => {
    execFile('java', ['-version'], { windowsHide: true }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return reject(new Error('Java was not found. Install Java and restart Ember.'));
      const n = parseJavaMajor(String(stderr || '') + String(stdout || ''));
      n ? resolve(n) : reject(new Error('Could not read your Java version.'));
    });
  });


  const javaRoot = (major) => path.join(app.getPath('userData'), 'java', String(Number(major)));

  async function ensureJava(major, say) {
    const have = findJavaBin(javaRoot(major));
    if (have) return have;
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new Error(`This server needs Java ${major} or newer. Install it from adoptium.net, then restart Ember.`);
    }
    say(`[Ember] This server needs Java ${major}. Downloading it now (about 50 MB). This only happens once.`);
    const info = await javaDownloadInfo(major);
    const base = path.join(app.getPath('userData'), 'java');
    fs.mkdirSync(base, { recursive: true });
    const zip = path.join(base, `java-${Number(major)}.zip`);
    const res = await fetch(info.url, { headers: { 'User-Agent': 'Ember-Launcher' } });
    if (!res.ok || !res.body) throw new Error(`Java download failed (HTTP ${res.status}).`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zip));
    if (info.sha256) {
      const sum = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
      if (sum !== info.sha256) { fs.rmSync(zip, { force: true }); throw new Error('The Java download did not match its checksum. Try again.'); }
    }
    say('[Ember] Unpacking Java...');
    const dest = javaRoot(major);
    fs.rmSync(dest, { recursive: true, force: true });
    try { await extractZip(zip, dest); } finally { fs.rmSync(zip, { force: true }); }
    const bin = findJavaBin(dest);
    if (!bin) throw new Error('Java was unpacked but could not be found.');
    say('[Ember] Java is ready.');
    return bin;
  }
  const starting = new Set();

  ipcMain.handle('host:start', async (_e, id) => {
    const cfg = find(id);
    if (running.has(id) || starting.has(id)) throw new Error('This server is already starting or running.');
    if (!cfg.eula) throw new Error('Accept the Minecraft EULA in the server settings first.');
    for (const other of running.keys()) {
      if (find(other).port === cfg.port) throw new Error(`Another server is already using port ${cfg.port}.`);
    }
    const dir = dirOf(id);
    if (!fs.existsSync(path.join(dir, 'server.jar'))) throw new Error('server.jar is missing.');
    starting.add(id);
    let javaCmd = 'java';
    try {
      let have = null;
      try { have = await javaMajor(); } catch { have = null; }
      if (have === null || have < cfg.javaMajor) javaCmd = await ensureJava(cfg.javaMajor, (l) => log(id, l));
    } finally {
      starting.delete(id);
    }
    if (running.has(id)) throw new Error('This server is already running.');
    const child = spawn(javaCmd, [`-Xmx${cfg.ram}M`, '-jar', 'server.jar', 'nogui'], { cwd: dir, windowsHide: true });
    running.set(id, child);
    send('host:status', { id, running: true });
    log(id, `[Ember] Starting ${cfg.name} (Minecraft ${cfg.version}) on port ${cfg.port}...`);
    for (const stream of [child.stdout, child.stderr]) {
      let buf = '';
      stream.on('data', (d) => {
        buf += d.toString('utf8');
        const parts = buf.split(/\r?\n/);
        buf = parts.pop();
        parts.forEach((l) => log(id, l));
      });
    }
    child.on('error', (e) => {
      log(id, `[Ember] ${e.message}`);
      if (!child.pid && running.get(id) === child) {
        running.delete(id);
        send('host:status', { id, running: false });
      }
    });
    child.on('exit', (code) => {
      running.delete(id);
      log(id, `[Ember] Server stopped (exit code ${code}).`);
      send('host:status', { id, running: false });
    });
    return true;
  });

  ipcMain.handle('host:stop', (_e, id) => {
    const child = running.get(id);
    if (!child) return false;
    child.stdin.write('stop\n');
    setTimeout(() => { if (running.get(id) === child) child.kill(); }, 30000);
    return true;
  });

  ipcMain.handle('host:command', (_e, id, cmd) => {
    const child = running.get(id);
    if (!child) throw new Error('The server is not running.');
    const c = text(cmd, 200, 'Command', true);
    child.stdin.write(c + '\n');
    return true;
  });

  ipcMain.handle('host:whitelist', (_e, id, name) => {
    const child = running.get(id);
    if (!child) throw new Error('Start the server first, then add friends.');
    if (!NAME_RE.test(String(name))) throw new Error('Minecraft usernames are 3 to 16 letters, numbers or underscores.');
    child.stdin.write(`whitelist add ${name}\n`);
    return true;
  });

  ipcMain.handle('host:network', () => {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
    return out;
  });

  ipcMain.handle('host:publicip', async () => {
    const res = await fetch('https://api.ipify.org');
    const ip = (await res.text()).trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error('Could not look up your public IP.');
    return ip;
  });

  ipcMain.handle('host:backup', async (_e, id) => {
    const cfg = find(id);
    if (running.has(id)) throw new Error('Stop the server first so the world is saved safely.');
    const res = await dialog.showOpenDialog({ title: 'Choose where to save the backup', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const safe = cfg.name.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'server';
    const src = path.resolve(dirOf(id));
    const dest = path.resolve(res.filePaths[0], `${safe}-backup-${stamp}`);
    if (dest.startsWith(src + path.sep)) throw new Error('Pick a folder outside the server folder.');
    await fs.promises.cp(src, dest, {
      recursive: true,
      filter: (p) => !['server.jar', 'logs', 'cache'].includes(path.basename(p))
    });
    return dest;
  });

  ipcMain.handle('host:openfolder', (_e, id) => shell.openPath(dirOf(id)));
  ipcMain.handle('host:openplayit', () => shell.openExternal('https://playit.gg'));
  ipcMain.handle('host:eula', () => shell.openExternal('https://aka.ms/MinecraftEULA'));


  // ---- tunnel (playit.gg) ----
  let tunnel = null;
  const playitExe = () => path.join(app.getPath('userData'), 'playit', 'playit.exe');
  const tlog = (line) => send('host:tunnellog', { line });

  async function ensurePlayit() {
    const exe = playitExe();
    if (fs.existsSync(exe)) return exe;
    tlog('[Ember] Downloading the playit program from its official GitHub page...');
    const url = await findPlayitAsset();
    const res = await fetch(url, { headers: { 'User-Agent': 'Ember-Launcher' } });
    if (!res.ok || !res.body) throw new Error(`playit download failed (HTTP ${res.status}).`);
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    const tmp = exe + '.tmp';
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    if (fs.statSync(tmp).size < 500000) { fs.rmSync(tmp, { force: true }); throw new Error('The playit download looks incomplete. Try again.'); }
    fs.renameSync(tmp, exe);
    tlog('[Ember] playit downloaded.');
    return exe;
  }

  ipcMain.handle('host:tunnelinfo', () => ({ running: !!tunnel }));

  ipcMain.handle('host:tunnelstart', async () => {
    if (tunnel) return true;
    const exe = await ensurePlayit();
    if (tunnel) return true;
    const child = spawn(exe, [], { cwd: path.dirname(exe), windowsHide: true });
    tunnel = child;
    send('host:tunnelstatus', { running: true });
    tlog('[Ember] Starting playit...');
    let opened = false;
    for (const stream of [child.stdout, child.stderr]) {
      let buf = '';
      stream.on('data', (d) => {
        buf += stripAnsi(d.toString('utf8'));
        const parts = buf.split('\n');
        buf = parts.pop();
        for (const raw of parts) {
          const line = raw.trim();
          if (!line) continue;
          tlog(line);
          const f = scanPlayitOutput(line);
          if (f.claim && !opened) { opened = true; shell.openExternal(f.claim); }
          if (f.claim || f.address) send('host:tunnel', f);
        }
      });
    }
    child.on('error', (e) => {
      tlog(`[Ember] ${e.message}`);
      if (!child.pid && tunnel === child) {
        tunnel = null;
        send('host:tunnelstatus', { running: false });
      }
    });
    child.on('exit', (code) => {
      if (tunnel === child) tunnel = null;
      tlog(`[Ember] playit stopped (exit code ${code}).`);
      send('host:tunnelstatus', { running: false });
    });
    return true;
  });

  ipcMain.handle('host:tunnelstop', () => {
    if (tunnel) tunnel.kill();
    return true;
  });

  ipcMain.handle('host:tunnelwindow', async () => {
    if (tunnel) throw new Error('Stop the tunnel in Ember first.');
    const exe = await ensurePlayit();
    const err = await shell.openPath(exe);
    if (err) throw new Error(err);
    return true;
  });

  ipcMain.handle('host:openclaim', (_e, url) => {
    const m = CLAIM_RE.exec(String(url));
    if (!m || m[0] !== String(url)) throw new Error('That is not a playit link.');
    return shell.openExternal(m[0]);
  });

  let quitting = false;
  app.on('before-quit', (e) => {
    if (tunnel) tunnel.kill();
    if (quitting || running.size === 0) return;
    e.preventDefault();
    quitting = true;
    for (const c of running.values()) c.stdin.write('stop\n');
    const hard = setTimeout(() => { for (const c of running.values()) c.kill(); app.quit(); }, 20000);
    const iv = setInterval(() => {
      if (running.size === 0) { clearInterval(iv); clearTimeout(hard); app.quit(); }
    }, 300);
  });

  return { ensureJava };
}

module.exports = { register, parseJavaMajor, escProp, mergeProps, validate, scanPlayitOutput, stripAnsi, extractZip, findJavaBin };
