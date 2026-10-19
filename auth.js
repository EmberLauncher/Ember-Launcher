'use strict';
// Microsoft sign-in for Minecraft (device code flow) plus cape changes.
// Tokens stay in this (main) process. The window only ever sees the player's name, skin and capes.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SCOPE = 'XboxLive.signin offline_access';
const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const MCS = 'https://api.minecraftservices.com';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEX = /^https?:\/\/textures\.minecraft\.net\//;
const XERR = {
  2148916233: 'This Microsoft account has no Xbox profile yet. Sign in once at xbox.com to create one, then try again.',
  2148916235: 'Xbox Live is not available in your country or region.',
  2148916236: 'This account needs adult verification on the Xbox website.',
  2148916237: 'This account needs adult verification on the Xbox website.',
  2148916238: 'This is a child account. An adult has to add it to a Microsoft family first.'
};
const NOT_APPROVED = 'Minecraft refused this app ID. New app IDs have to be approved by Mojang before they can sign players in. Open the one-time setup guide for the steps.';

async function form(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params)
  });
  let json = {};
  try { json = await res.json(); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, json };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  let json = {};
  try { json = await res.json(); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, json };
}

async function minecraftLogin(msAccessToken) {
  const x = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });
  if (!x.ok || !x.json.Token) throw new Error(`Xbox sign-in failed (HTTP ${x.status}).`);
  const s = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [x.json.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  });
  if (!s.ok) throw new Error(XERR[s.json.XErr] || `Xbox security check failed (HTTP ${s.status}).`);
  const uhs = s.json.DisplayClaims && s.json.DisplayClaims.xui && s.json.DisplayClaims.xui[0] && s.json.DisplayClaims.xui[0].uhs;
  if (!uhs || !s.json.Token) throw new Error('Xbox sent an unexpected answer.');
  const m = await postJson(`${MCS}/authentication/login_with_xbox`, { identityToken: `XBL3.0 x=${uhs};${s.json.Token}` });
  if (m.status === 403) throw new Error(NOT_APPROVED);
  if (!m.ok || !m.json.access_token) throw new Error(`Minecraft sign-in failed (HTTP ${m.status}).`);
  return { mcToken: m.json.access_token, expires: Date.now() + (Number(m.json.expires_in) || 86400) * 1000 };
}

// Offline mode: no sign-in, just a username. Minecraft usernames are 3-16 letters, numbers or underscores.
const OFFLINE_NAME = /^[A-Za-z0-9_]{3,16}$/;
const validOfflineName = (n) => typeof n === 'string' && OFFLINE_NAME.test(n);

// Same ID vanilla gives an offline player (Java's UUID.nameUUIDFromBytes("OfflinePlayer:" + name)),
// so worlds and offline-mode servers see the same player every time. Returned without dashes.
function offlineUuid(name) {
  const b = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b.toString('hex');
}

const texUrl = (u) => (typeof u === 'string' && TEX.test(u) ? u.replace(/^http:/, 'https:') : '');

function normalizeProfile(p) {
  const skin = (p.skins || []).find((s) => s.state === 'ACTIVE') || (p.skins || [])[0] || {};
  return {
    id: String(p.id || ''),
    name: String(p.name || ''),
    skinUrl: texUrl(skin.url),
    skinVariant: String(skin.variant || 'CLASSIC').toUpperCase(),
    capes: (p.capes || []).map((c) => ({ id: String(c.id), alias: String(c.alias || 'Cape'), url: texUrl(c.url), active: c.state === 'ACTIVE' }))
  };
}

async function fetchProfile(mcToken) {
  const res = await fetch(`${MCS}/minecraft/profile`, { headers: { Authorization: `Bearer ${mcToken}` } });
  if (res.status === 404) throw new Error('This Microsoft account does not own Minecraft: Java Edition, or it has no Minecraft profile yet.');
  if (!res.ok) throw new Error(`Could not load your Minecraft profile (HTTP ${res.status}).`);
  return normalizeProfile(await res.json());
}

function register({ app, ipcMain, shell, safeStorage, getWindow, sleep }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const cfgFile = () => path.join(app.getPath('userData'), 'auth-config.json');
  const accFile = () => path.join(app.getPath('userData'), 'account.bin');
  const offFile = () => path.join(app.getPath('userData'), 'offline.json');
  const send = (ch, payload) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(ch, payload); };

  let loaded = false;
  let refreshToken = '';
  let offlineName = '';
  let profile = null;
  let mc = null;
  let flow = null;

  const canEncrypt = () => !!(safeStorage && safeStorage.isEncryptionAvailable());
  const getClientId = () => {
    try { const c = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')).clientId; return GUID.test(c) ? c : ''; } catch { return ''; }
  };
  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const n = JSON.parse(fs.readFileSync(offFile(), 'utf8')).name;
      offlineName = validOfflineName(n) ? n : '';
    } catch { /* no offline name saved */ }
    try {
      if (!canEncrypt()) return;
      const o = JSON.parse(safeStorage.decryptString(fs.readFileSync(accFile())));
      refreshToken = String(o.refreshToken || '');
      profile = o.profile || null;
    } catch { /* nothing saved yet */ }
  }
  function persist() {
    if (!canEncrypt()) return;
    fs.mkdirSync(path.dirname(accFile()), { recursive: true });
    fs.writeFileSync(accFile(), safeStorage.encryptString(JSON.stringify({ refreshToken, profile })));
  }
  function clear() {
    refreshToken = ''; profile = null; mc = null;
    fs.rmSync(accFile(), { force: true });
  }
  function status() {
    load();
    const signedIn = !!(refreshToken && profile);
    const mode = signedIn ? 'microsoft' : offlineName ? 'offline' : 'none';
    return {
      clientIdSet: !!getClientId(),
      signedIn,
      mode,
      offlineName,
      canRemember: canEncrypt(),
      name: signedIn ? profile.name : offlineName,
      id: signedIn ? profile.id : offlineName ? offlineUuid(offlineName) : '',
      skinUrl: profile ? profile.skinUrl : '',
      skinVariant: profile ? profile.skinVariant : 'CLASSIC',
      capes: profile ? profile.capes : []
    };
  }

  async function getSession() {
    load();
    if (mc && profile && Date.now() < mc.expires - 60000) return { mcToken: mc.mcToken, profile };
    if (!refreshToken) {
      if (offlineName) {
        return {
          mcToken: '0',
          offline: true,
          profile: { id: offlineUuid(offlineName), name: offlineName, skinUrl: '', skinVariant: 'CLASSIC', capes: [] }
        };
      }
      throw new Error('Sign in with Microsoft first, or choose an offline username.');
    }
    const clientId = getClientId();
    if (!clientId) throw new Error('Add your Microsoft app ID first.');
    const t = await form(`${MS}/token`, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, scope: SCOPE });
    if (!t.ok) {
      if (t.json.error === 'invalid_grant') { clear(); throw new Error('Your sign-in expired. Please sign in again.'); }
      throw new Error(`Could not refresh your sign-in (HTTP ${t.status}).`);
    }
    if (t.json.refresh_token) refreshToken = t.json.refresh_token;
    mc = await minecraftLogin(t.json.access_token);
    profile = await fetchProfile(mc.mcToken);
    persist();
    return { mcToken: mc.mcToken, profile };
  }

  ipcMain.handle('auth:status', () => status());

  ipcMain.handle('auth:setclient', (_e, id) => {
    const v = String(id || '').trim();
    if (!GUID.test(v)) throw new Error('That does not look like an app ID. It is 32 letters and numbers with dashes, like 11111111-2222-3333-4444-555555555555.');
    fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
    fs.writeFileSync(cfgFile(), JSON.stringify({ clientId: v }));
    return status();
  });

  ipcMain.handle('auth:signin', async () => {
    load();
    const clientId = getClientId();
    if (!clientId) throw new Error('Add your Microsoft app ID first.');
    if (flow) throw new Error('Sign-in is already in progress.');
    const mine = (flow = { cancelled: false });
    try {
      const dc = await form(`${MS}/devicecode`, { client_id: clientId, scope: SCOPE });
      if (!dc.ok || !dc.json.device_code) {
        throw new Error((dc.json.error_description || 'Microsoft refused the app ID.').split('\r')[0].split('\n')[0]);
      }
      const uri = String(dc.json.verification_uri || 'https://www.microsoft.com/link');
      send('auth:code', { userCode: dc.json.user_code, verificationUri: uri, expiresIn: dc.json.expires_in });
      let host = '';
      try { host = new URL(uri).hostname; } catch { /* ignore */ }
      if (/(^|\.)(microsoft\.com|microsoftonline\.com|live\.com)$/.test(host)) shell.openExternal(uri);
      const deadline = Date.now() + (Number(dc.json.expires_in) || 900) * 1000;
      let interval = (Number(dc.json.interval) || 5) * 1000;
      let token = null;
      while (Date.now() < deadline) {
        await wait(interval);
        if (mine.cancelled) throw new Error('Sign-in cancelled.');
        const t = await form(`${MS}/token`, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: dc.json.device_code });
        if (t.ok) { token = t.json; break; }
        const e = t.json.error;
        if (e === 'authorization_pending') continue;
        if (e === 'slow_down') { interval += 5000; continue; }
        if (e === 'authorization_declined') throw new Error('Sign-in was declined.');
        if (e === 'expired_token') break;
        throw new Error((t.json.error_description || `Sign-in failed (${e || t.status}).`).split('\r')[0]);
      }
      if (!token) throw new Error('The sign-in code expired. Try again.');
      mc = await minecraftLogin(token.access_token);
      profile = await fetchProfile(mc.mcToken);
      refreshToken = String(token.refresh_token || '');
      persist();
      return status();
    } finally {
      if (flow === mine) flow = null;
    }
  });

  ipcMain.handle('auth:setoffline', (_e, name) => {
    load();
    const v = String(name || '').trim();
    if (!validOfflineName(v)) throw new Error('A username is 3 to 16 characters: letters, numbers and underscores only.');
    fs.mkdirSync(path.dirname(offFile()), { recursive: true });
    fs.writeFileSync(offFile(), JSON.stringify({ name: v }));
    offlineName = v;
    return status();
  });

  ipcMain.handle('auth:clearoffline', () => {
    load();
    offlineName = '';
    fs.rmSync(offFile(), { force: true });
    return status();
  });

  ipcMain.handle('auth:open', (_e, which) => {
    const url = { azure: 'https://portal.azure.com', wiki: 'https://minecraft.wiki/w/Microsoft_authentication' }[String(which)];
    if (!url) throw new Error('Unknown link.');
    return shell.openExternal(url);
  });

  ipcMain.handle('auth:cancel', () => { if (flow) flow.cancelled = true; return true; });

  ipcMain.handle('auth:signout', () => { load(); clear(); return status(); });

  ipcMain.handle('auth:setcape', async (_e, capeId) => {
    const s = await getSession();
    if (s.offline) throw new Error('Capes need a Microsoft account.');
    if (capeId !== null && !s.profile.capes.some((c) => c.id === capeId)) throw new Error('You do not own that cape.');
    const res = await fetch(`${MCS}/minecraft/profile/capes/active`, {
      method: capeId ? 'PUT' : 'DELETE',
      headers: { Authorization: `Bearer ${s.mcToken}`, 'Content-Type': 'application/json' },
      body: capeId ? JSON.stringify({ capeId }) : undefined
    });
    if (!res.ok) throw new Error(`Could not change your cape (HTTP ${res.status}).`);
    profile = normalizeProfile(await res.json());
    persist();
    return status();
  });

  return { getSession, status };
}

module.exports = { register, normalizeProfile, offlineUuid, validOfflineName };
