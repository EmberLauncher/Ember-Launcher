'use strict';
// Downloads and launches Minecraft (vanilla and Fabric) for Ember.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { pathToFileURL } = require('url');

const MANIFESTS = [
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'
];
const RESOURCES = 'https://resources.download.minecraft.net';
const FABRIC = 'https://meta.fabricmc.net/v2/versions/loader';
const VER_RE = /^[0-9A-Za-z._-]{1,32}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const SERVER_RE = /^[A-Za-z0-9._\-\[\]:]{1,255}$/;
const LOADERS = ['vanilla', 'fabric'];

const osName = () => ({ win32: 'windows', darwin: 'osx', linux: 'linux' })[process.platform] || 'linux';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ruleMatches(rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osName()) return false;
    const arch = process.arch === 'ia32' ? 'x86' : process.arch;
    if (rule.os.arch && rule.os.arch !== arch) return false;
    if (rule.os.version && !new RegExp(rule.os.version).test(os.release())) return false;
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) if (!!features[k] !== !!v) return false;
  }
  return true;
}

function allowed(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let ok = false;
  for (const r of rules) if (ruleMatches(r, features)) ok = r.action === 'allow';
  return ok;
}

function mavenPath(name) {
  const [coord, ext = 'jar'] = name.split('@');
  const [g, a, v, c] = coord.split(':');
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext}`;
}
const libKey = (name) => { const [g, a, , c] = name.split('@')[0].split(':'); return [g, a, c || ''].join(':'); };

function collectLibraries(v) {
  const map = new Map();
  for (const lib of v.libraries || []) {
    if (!lib.name || !allowed(lib.rules)) continue;
    const entries = [];
    const art = lib.downloads && lib.downloads.artifact;
    if (art) entries.push({ path: art.path, url: art.url, sha1: art.sha1, size: art.size, native: false });
    else if (!lib.natives) {
      const p = mavenPath(lib.name);
      entries.push({ path: p, url: (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/') + p, sha1: lib.sha1, size: lib.size, native: false });
    }
    if (lib.natives && lib.natives[osName()]) {
      const cls = lib.natives[osName()].replace('${arch}', process.arch === 'ia32' ? '32' : '64');
      const c = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[cls];
      if (c) entries.push({ path: c.path, url: c.url, sha1: c.sha1, size: c.size, native: true });
    }
    map.set(libKey(lib.name), entries);
  }
  return [...map.values()].flat();
}

function mergeVersions(parent, child) {
  const arr = (x) => (x && x.arguments && x.arguments) || {};
  return {
    ...parent,
    ...child,
    id: child.id || parent.id,
    libraries: [...(parent.libraries || []), ...(child.libraries || [])],
    mainClass: child.mainClass || parent.mainClass,
    arguments: (parent.arguments || child.arguments)
      ? { jvm: [...(arr(parent).jvm || []), ...(arr(child).jvm || [])], game: [...(arr(parent).game || []), ...(arr(child).game || [])] }
      : undefined,
    minecraftArguments: child.minecraftArguments || parent.minecraftArguments,
    assetIndex: child.assetIndex || parent.assetIndex,
    downloads: child.downloads || parent.downloads,
    javaVersion: child.javaVersion || parent.javaVersion
  };
}

const sub = (s, vars) => String(s).replace(/\$\{([^}]+)\}/g, (_m, k) => (k in vars ? String(vars[k]) : ''));

function expandArgs(list, vars, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') { out.push(sub(a, vars)); continue; }
    if (!allowed(a.rules, features)) continue;
    for (const val of [].concat(a.value)) out.push(sub(val, vars));
  }
  return out;
}

function buildCommand(v, vars, features) {
  const jvm = v.arguments && v.arguments.jvm
    ? expandArgs(v.arguments.jvm, vars, features)
    : ['-Djava.library.path=' + vars.natives_directory, '-cp', vars.classpath];
  const game = v.arguments && v.arguments.game
    ? expandArgs(v.arguments.game, vars, features)
    : String(v.minecraftArguments || '').split(' ').filter(Boolean).map((s) => sub(s, vars));
  return { jvm, game };
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

async function getJson(url) {
  if (!/^https:\/\//.test(url)) throw new Error('Refusing a non-https address.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  return res.json();
}

async function download({ url, dest, sha1, size }) {
  if (!/^https:\/\//.test(url)) throw new Error('Refusing a non-https address.');
  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (!size || st.size === size) return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      const tmp = dest + '.part';
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      if (sha1 && crypto.createHash('sha1').update(fs.readFileSync(tmp)).digest('hex') !== sha1) {
        fs.rmSync(tmp, { force: true });
        throw new Error('checksum mismatch');
      }
      fs.renameSync(tmp, dest);
      return true;
    } catch (e) {
      if (attempt >= 3) throw new Error(`Could not download ${path.basename(dest)}: ${e.message}`);
      await sleep(400 * attempt);
    }
  }
}

function register({ app, ipcMain, shell, getWindow, getSession, ensureJava, extractZip }) {
  const root = () => path.join(app.getPath('userData'), 'game');
  const send = (ch, payload) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(ch, payload); };
  const instanceDir = (id) => {
    if (!ID_RE.test(String(id))) throw new Error('Bad profile id.');
    return path.join(app.getPath('userData'), 'instances', id);
  };
  const playing = new Map();
  const preparing = new Set();

  async function manifest() {
    let last;
    for (const u of MANIFESTS) { try { return await getJson(u); } catch (e) { last = e; } }
    throw new Error('Could not reach Mojang. Check your internet connection. ' + (last ? last.message : ''));
  }

  async function versionJson(mc) {
    const file = path.join(root(), 'versions', mc, `${mc}.json`);
    if (fs.existsSync(file)) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* download again */ } }
    const entry = (await manifest()).versions.find((x) => x.id === mc);
    if (!entry) throw new Error(`Minecraft ${mc} was not found.`);
    const j = await getJson(entry.url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(j));
    return j;
  }

  async function fabricJson(mc) {
    const list = await getJson(`${FABRIC}/${encodeURIComponent(mc)}`);
    if (!Array.isArray(list) || !list.length) throw new Error(`Fabric does not support Minecraft ${mc} yet.`);
    const pick = list.find((x) => x.loader && x.loader.stable) || list[0];
    const lv = String(pick.loader.version);
    if (!VER_RE.test(lv)) throw new Error('Unexpected Fabric version.');
    return getJson(`${FABRIC}/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`);
  }

  async function launch({ profile, server }, emit) {
    const id = String(profile && profile.id);
    const mcVer = String(profile && profile.version);
    const loader = String(profile && profile.loader);
    if (!VER_RE.test(mcVer)) throw new Error('Pick a Minecraft version for this profile.');
    if (!LOADERS.includes(loader)) throw new Error('Only Vanilla and Fabric profiles can launch right now.');
    if (server !== undefined && server !== null && !SERVER_RE.test(String(server))) throw new Error('That server address looks wrong.');
    const gameDir = instanceDir(id);
    const session = await getSession();

    emit({ text: 'Checking Minecraft ' + mcVer + '...', pct: 0 });
    let v = await versionJson(mcVer);
    if (loader === 'fabric') {
      emit({ text: 'Getting Fabric...', pct: 0 });
      v = mergeVersions(v, await fabricJson(mcVer));
    }

    const libs = collectLibraries(v);
    const clientJar = path.join(root(), 'versions', mcVer, `${mcVer}.jar`);
    const files = [];
    if (!v.downloads || !v.downloads.client) throw new Error('This version has no client download.');
    files.push({ url: v.downloads.client.url, dest: clientJar, sha1: v.downloads.client.sha1, size: v.downloads.client.size });
    for (const l of libs) files.push({ url: l.url, dest: path.join(root(), 'libraries', l.path), sha1: l.sha1, size: l.size });

    const idx = v.assetIndex;
    if (!idx) throw new Error('This version has no asset list.');
    const idxFile = path.join(root(), 'assets', 'indexes', `${idx.id}.json`);
    await download({ url: idx.url, dest: idxFile, sha1: idx.sha1, size: idx.size });
    const objects = JSON.parse(fs.readFileSync(idxFile, 'utf8')).objects || {};
    for (const o of Object.values(objects)) {
      files.push({ url: `${RESOURCES}/${o.hash.slice(0, 2)}/${o.hash}`, dest: path.join(root(), 'assets', 'objects', o.hash.slice(0, 2), o.hash), sha1: o.hash, size: o.size });
    }

    let done = 0;
    await pool(files, 12, async (f) => {
      await download(f);
      done++;
      if (done % 25 === 0 || done === files.length) emit({ text: `Downloading game files (${done} of ${files.length})...`, pct: Math.round((done / files.length) * 100) });
    });

    const nativesDir = path.join(root(), 'natives', id);
    fs.rmSync(nativesDir, { recursive: true, force: true });
    fs.mkdirSync(nativesDir, { recursive: true });
    for (const l of libs.filter((x) => x.native)) {
      await extractZip(path.join(root(), 'libraries', l.path), nativesDir);
    }
    fs.rmSync(path.join(nativesDir, 'META-INF'), { recursive: true, force: true });

    const javaMajor = (v.javaVersion && v.javaVersion.majorVersion) || 8;
    emit({ text: `Getting Java ${javaMajor}...`, pct: 100 });
    const javaBin = await ensureJava(javaMajor, (t) => emit({ text: t.replace(/^\[Ember\] /, ''), pct: 100 }));

    const sepChar = process.platform === 'win32' ? ';' : ':';
    const cp = [...libs.filter((x) => !x.native).map((l) => path.join(root(), 'libraries', l.path)), clientJar].join(sepChar);
    const hasQuick = ((v.arguments && v.arguments.game) || []).some((a) => typeof a === 'object' && (a.rules || []).some((r) => r.features && 'has_quick_plays_support' in r.features));
    const features = server && hasQuick ? { has_quick_plays_support: true, is_quick_play_multiplayer: true } : {};
    const vars = {
      auth_player_name: session.profile.name,
      version_name: mcVer,
      game_directory: gameDir,
      assets_root: path.join(root(), 'assets'),
      assets_index_name: idx.id,
      auth_uuid: session.profile.id,
      auth_access_token: session.mcToken,
      clientid: '',
      auth_xuid: '',
      user_type: session.offline ? 'legacy' : 'msa',
      version_type: v.type || 'release',
      launcher_name: 'Ember',
      launcher_version: '0.7',
      natives_directory: nativesDir,
      library_directory: path.join(root(), 'libraries'),
      classpath_separator: sepChar,
      classpath: cp,
      user_properties: '{}',
      game_assets: path.join(root(), 'assets', 'virtual', 'legacy'),
      quickPlayPath: 'quickPlay/ember.json',
      quickPlayMultiplayer: String(server || '')
    };
    const cmd = buildCommand(v, vars, features);
    if (server && !hasQuick) {
      const [host, port] = String(server).split(/:(?=\d+$)/);
      cmd.game.push('--server', host, '--port', port || '25565');
    }
    fs.mkdirSync(gameDir, { recursive: true });
    const args = [`-Xmx${Number(profile.ram) || 2048}M`, ...cmd.jvm, v.mainClass, ...cmd.game];
    const started = Date.now();
    const logFile = path.join(gameDir, 'ember-launch.log');
    const logStream = fs.createWriteStream(logFile);
    const child = spawn(javaBin, args, { cwd: gameDir, windowsHide: true });
    playing.set(id, child);
    send('game:status', { profileId: id, running: true });
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => logStream.write(d));
    child.on('error', (e) => { logStream.write(`[Ember] ${e.message}\n`); });
    child.on('exit', (code) => {
      playing.delete(id);
      logStream.end();
      let photo = null;
      try { photo = latestScreenshot(gameDir, started); } catch { /* no photo */ }
      send('game:status', { profileId: id, running: false, code, logFile: code ? logFile : '' });
      if (photo) send('game:photo', { profileId: id, url: photo });
    });
    return true;
  }

  function latestScreenshot(gameDir, since) {
    const dir = path.join(gameDir, 'screenshots');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.t >= since - 1000).sort((a, b) => b.t - a.t);
    if (!files.length) return null;
    const photos = path.join(app.getPath('userData'), 'photos');
    fs.mkdirSync(photos, { recursive: true });
    const dest = path.join(photos, Date.now() + '.png');
    fs.copyFileSync(path.join(dir, files[0].f), dest);
    return pathToFileURL(dest).href;
  }

  ipcMain.handle('game:play', async (_e, req) => {
    const id = String(req && req.profile && req.profile.id);
    if (!ID_RE.test(id)) throw new Error('Bad profile id.');
    if (playing.has(id) || preparing.has(id)) throw new Error('This profile is already starting or running.');
    preparing.add(id);
    try {
      return await launch(req, (p) => send('game:progress', { profileId: id, ...p }));
    } finally {
      preparing.delete(id);
    }
  });

  ipcMain.handle('game:stop', (_e, id) => { const c = playing.get(String(id)); if (c) c.kill(); return true; });
  ipcMain.handle('game:running', () => [...playing.keys()]);
  ipcMain.handle('game:openfolder', async (_e, id) => {
    const dir = instanceDir(String(id));
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  ipcMain.handle('game:openlog', (_e, id) => shell.openPath(path.join(instanceDir(String(id)), 'ember-launch.log')));

  return { launch };
}

module.exports = { register, allowed, collectLibraries, mergeVersions, buildCommand, mavenPath, expandArgs };
