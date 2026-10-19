'use strict';

const ICON = {
  home: '<path d="M3 11l9-8 9 8v10H3z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 15-5 16 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'
};
const svg = (p, size = 22, fill = 'none') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

const FIGURE = '<svg width="96" height="192" viewBox="0 0 64 128" shape-rendering="crispEdges" role="img" aria-label="Skin preview"><rect x="16" y="0" width="32" height="32" fill="#d9a066"/><rect x="16" y="0" width="32" height="10" fill="#3b2a1a"/><rect x="22" y="16" width="6" height="6" fill="#fff"/><rect x="36" y="16" width="6" height="6" fill="#fff"/><rect x="16" y="32" width="32" height="48" fill="#3b82f6"/><rect x="0" y="32" width="16" height="48" fill="#d9a066"/><rect x="48" y="32" width="16" height="48" fill="#d9a066"/><rect x="16" y="80" width="16" height="48" fill="#374151"/><rect x="32" y="80" width="16" height="48" fill="#4b5563"/></svg>';

const GRADS = [
  'linear-gradient(180deg,#2a1450,#c2410c 70%,#1a1208)',
  'linear-gradient(180deg,#0c2a3d,#0e7490 60%,#10200f)',
  'linear-gradient(180deg,#3b0d1f,#f97316 80%,#1f1209)'
];
const PRESETS = [
  ['#f97316', '#22c55e'], ['#ec4899', '#14b8a6'], ['#8b5cf6', '#22c55e'],
  ['#3b82f6', '#eab308'], ['#14b8a6', '#f97316']
];
const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };

let state;
let route = 'home';
let search = '';
let hosted = [];
let hostSel = null;
let net = [];
let account = { clientIdSet: false, signedIn: false, mode: 'none', offlineName: '', canRemember: true, name: '', id: '', skinUrl: '', skinVariant: 'CLASSIC', capes: [] };
const playing = {};
const tunnel = { running: false, claim: '', address: '', log: [], hint: false, timer: null };
const logs = {};
const errMsg = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const gradFor = (name) => GRADS[[...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0) % GRADS.length];
const save = () => window.api.setState(state);

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const textOn = (hex) => (lum(hex) > 0.35 ? '#0a0a0a' : '#ffffff');

function applyColors() {
  const c = state.colors;
  const r = document.documentElement.style;
  r.setProperty('--a', c.accent);
  r.setProperty('--g', c.action);
  r.setProperty('--bg', c.bg);
  r.setProperty('--on-a', textOn(c.accent));
  r.setProperty('--on-g', textOn(c.action));
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------- pages ---------- */

function renderNav() {
  const items = [['home', 'home', 'Home'], ['profiles', 'grid', 'Profiles'], ['skins', 'user', 'Skins & capes'], ['host', 'server', 'Host a server']];
  $('#nav').innerHTML =
    items.map(([r, i, l]) => `<button class="n${route === r ? ' on' : ''}" data-act="go" data-route="${r}" aria-label="${esc(l)}" title="${esc(l)}">${svg(ICON[i])}</button>`).join('') +
    `<div class="sp"></div><button class="n${route === 'appearance' ? ' on' : ''}" data-act="go" data-route="appearance" aria-label="Appearance" title="Appearance">${svg(ICON.gear)}</button>`;
}

function profileCard(p) {
  const bg = p.photo ? `url("${esc(p.photo)}")` : gradFor(p.name);
  return `<div class="c" style="overflow:hidden"><div class="thumb" style="background-image:${bg}"></div><div class="pad"><div style="font-weight:700;font-size:15px">${esc(p.name)}</div><div class="muted" style="margin:4px 0 12px">${esc(LOADERS[p.loader] || p.loader)} · ${esc(p.version)}</div>${playBtn(p)}<div class="row" style="margin-top:8px;gap:6px"><button class="b" style="padding:0 12px" data-act="photo" data-id="${p.id}">Photo</button><button class="b" style="padding:0 12px" data-act="profilefolder" data-id="${p.id}">Files</button><button class="b" style="padding:0 12px" data-act="delprofile" data-id="${p.id}">Delete</button></div></div></div>`;
}

function serverRow(s) {
  return `<div class="s"><button class="n" style="width:44px;height:44px${s.fav ? ';color:var(--a)' : ''}" data-act="fav" data-id="${s.id}" aria-label="${s.fav ? 'Remove favorite' : 'Add favorite'}">${svg(ICON.star, 20, s.fav ? 'currentColor' : 'none')}</button><div><b>${esc(s.name)}</b><small>${esc(s.address)}</small></div><button class="b g" data-act="join" data-id="${s.id}">Join</button><button class="b" data-act="delserver" data-id="${s.id}" aria-label="Remove ${esc(s.name)}">×</button></div>`;
}

function skinPreview() {
  if (account.signedIn && account.skinUrl) {
    return `<canvas data-skin="${esc(account.skinUrl)}" data-variant="${esc(account.skinVariant)}" width="96" height="192" role="img" aria-label="Your skin"></canvas>`;
  }
  return FIGURE;
}

function drawSkins() {
  document.querySelectorAll('canvas[data-skin]').forEach((c) => {
    const img = new Image();
    img.onload = () => {
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      const s = 6;
      const slim = c.dataset.variant === 'SLIM';
      const legacy = img.naturalHeight === 32;
      const aw = slim ? 3 : 4;
      const part = (sx, sy, sw, sh, dx, dy, flip) => {
        if (flip) {
          ctx.save();
          ctx.translate((dx + sw) * s, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, sx, sy, sw, sh, 0, dy * s, sw * s, sh * s);
          ctx.restore();
        } else {
          ctx.drawImage(img, sx, sy, sw, sh, dx * s, dy * s, sw * s, sh * s);
        }
      };
      part(4, 20, 4, 12, 4, 20);
      part(legacy ? 4 : 20, legacy ? 20 : 52, 4, 12, 8, 20, legacy);
      part(44, 20, aw, 12, slim ? 1 : 0, 8);
      part(legacy ? 44 : 36, legacy ? 20 : 52, aw, 12, 12, 8, legacy);
      part(20, 20, 8, 12, 4, 8);
      part(8, 8, 8, 8, 4, 0);
      if (!legacy) {
        part(4, 36, 4, 12, 4, 20);
        part(4, 52, 4, 12, 8, 20);
        part(20, 36, 8, 12, 4, 8);
        part(44, 36, aw, 12, slim ? 1 : 0, 8);
        part(52, 52, aw, 12, 12, 8);
      }
      part(40, 8, 8, 8, 4, 0);
    };
    img.src = c.dataset.skin;
  });
  document.querySelectorAll('canvas[data-cape]').forEach((c) => {
    const img = new Image();
    img.onload = () => {
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 1, 1, 10, 16, 0, 0, c.width, c.height);
    };
    img.src = c.dataset.cape;
  });
}

const playBtn = (p, big) => {
  const st = big ? 'style="font-size:18px;padding:0 36px;min-height:56px"' : 'style="width:100%"';
  return playing[p.id]
    ? `<button class="b" ${st} data-act="stopgame" data-id="${p.id}">Stop game</button>`
    : `<button class="b g" ${st} data-act="play" data-id="${p.id}">${big ? 'Play' : 'Play now'}</button>`;
};

function pageHome() {
  const sorted = [...state.profiles].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  const last = sorted[0];
  const favs = state.servers.filter((s) => s.fav);
  const recent = state.servers.filter((s) => !s.fav && s.lastJoined).sort((a, b) => b.lastJoined - a.lastJoined);
  const others = state.servers.filter((s) => !s.fav && !s.lastJoined);
  const hero = last
    ? `<section class="hero" style="${last.photo ? `background-image:linear-gradient(#0004,#000a),url('${esc(last.photo)}')` : ''}"><div class="chip">${last.photo ? 'World photo' : 'No photo yet'}</div><div class="cap"><div><div class="k">${last.lastPlayed ? 'LAST PLAYED' : 'YOUR PROFILE'}</div><div class="t">${esc(last.name)}</div><div style="margin-top:4px">${esc(LOADERS[last.loader] || last.loader)} ${esc(last.version)}</div></div><div class="row"><button class="b" data-act="photo" data-id="${last.id}">Set photo</button>${playBtn(last, true)}</div></div></section>`
    : `<section class="hero"><div class="cap"><div><div class="k">GET STARTED</div><div class="t">Create your first profile</div></div><button class="b g" style="min-height:56px;padding:0 32px" data-act="newprofile">New profile</button></div></section>`;
  return `<div class="cols"><div class="stack"><div class="row"><h1>Welcome back</h1><button class="b o" data-act="newprofile">New profile</button></div>${hero}
<div><div style="font-weight:700;margin-bottom:12px">Recent profiles</div>${sorted.length ? `<div class="grid3">${sorted.slice(0, 3).map(profileCard).join('')}</div>` : '<div class="c empty">No profiles yet.</div>'}</div></div>
<aside class="stack"><section class="c pad20" style="display:flex;gap:20px;align-items:center"><div style="background:#0d0d0d;border-radius:16px;padding:12px">${skinPreview()}</div><div><div class="lbl" style="color:var(--a);margin:0">YOUR SKIN</div><div style="font-size:20px;font-weight:700;margin:6px 0 14px">${esc(account.name || '[Username]')}${account.mode === 'offline' ? ' <span class="muted" style="font-weight:500">(offline)</span>' : ''}</div><button class="b" data-act="go" data-route="skins">Skins &amp; capes</button></div></section>
<section class="c pad20"><div class="row"><div style="font-weight:700;font-size:16px">Quick join</div><button class="b" data-act="newserver">Add server</button></div>
<div class="lbl">FAVORITES</div>${favs.length ? favs.map(serverRow).join('') : '<div class="muted" style="padding:8px 0">Star a server to pin it here.</div>'}
${recent.length ? `<div class="lbl">RECENTLY PLAYED</div>${recent.map(serverRow).join('')}` : ''}
${others.length ? `<div class="lbl">OTHER SERVERS</div>${others.map(serverRow).join('')}` : ''}</section></aside></div>`;
}

function pageProfiles() {
  const list = state.profiles.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  return `<div class="stack"><div class="row"><h1>Profiles</h1><button class="b g" data-act="newprofile">New profile</button></div>
<label class="field" style="margin:0"><span style="position:absolute;left:-9999px">Search profiles</span><input type="text" id="search" placeholder="Search profiles" value="${esc(search)}"></label>
${list.length ? `<div class="grid3">${list.map(profileCard).join('')}</div>` : `<div class="c empty">${state.profiles.length ? 'No profiles match your search.' : 'No profiles yet. Create one to get started.'}</div>`}</div>`;
}

function pageAppearance() {
  const c = state.colors;
  const sw = PRESETS.map(([a, g], i) => `<button class="sw" data-act="preset" data-i="${i}" aria-label="Preset ${i + 1}" style="background:linear-gradient(135deg,${a} 50%,${g} 50%)"></button>`).join('');
  const pick = (k, l) => `<div class="row" style="padding:8px 0"><label for="c-${k}" style="font-weight:700">${l}</label><input type="color" id="c-${k}" data-color="${k}" value="${c[k]}"></div>`;
  return `<div class="stack" style="max-width:760px"><h1>Appearance</h1>
<section class="c pad24"><div style="font-weight:700;margin-bottom:6px">Color presets</div><div class="muted" style="margin-bottom:14px">Pick a pair, then fine-tune below.</div><div style="display:flex;gap:12px">${sw}</div></section>
<section class="c pad24"><div style="font-weight:700">Custom colors</div>${pick('accent', 'Accent')}${pick('action', 'Action buttons')}${pick('bg', 'Background')}<button class="b" data-act="resetcolors" style="margin-top:8px">Reset to default</button></section>
<section class="c pad24 row"><div style="font-weight:700">Live preview</div><div style="display:flex;gap:12px"><button class="b o">Accent</button><button class="b g">Play</button></div></section></div>`;
}

function setupCard() {
  return `<section class="c pad24"><div style="font-weight:700;margin-bottom:6px">One-time setup to sign in with Microsoft</div>
<div class="muted" style="margin-bottom:14px">Minecraft only lets approved apps sign players in. You need your own free app ID, and Mojang has to approve it. The guide shows each step. When you have the ID, paste it here.</div>
<form id="clientform" class="row" style="gap:12px"><input type="text" id="clientid" placeholder="Application (client) ID" autocomplete="off"><button class="b g">Save ID</button></form>
<div style="margin-top:12px"><button class="b o" data-act="authguide">Open the setup guide</button></div></section>`;
}

function signInCard() {
  return `<section class="c pad24" style="text-align:center"><div style="display:inline-block;background:#0d0d0d;border-radius:16px;padding:16px">${FIGURE}</div>
<div style="font-weight:700;font-size:18px;margin:14px 0 6px">Sign in to see your skin and capes</div>
<div class="muted" style="margin-bottom:16px">Signing in also lets you join online servers. Ember never sees your password.</div>
<button class="b g" data-act="signin" style="min-height:52px;padding:0 32px;font-size:16px">Sign in with Microsoft</button>
<div style="margin-top:14px;display:flex;gap:8px;justify-content:center"><button class="b" data-act="authguide">Setup guide</button><button class="b" data-act="changeclient">Change app ID</button></div></section>`;
}

function capeTile(c) {
  const active = c ? c.active : !account.capes.some((x) => x.active);
  const label = c ? c.alias : 'No cape';
  const thumb = c && c.url
    ? `<canvas data-cape="${esc(c.url)}" width="60" height="96"></canvas>`
    : '<div style="width:60px;height:96px;border-radius:6px;background:repeating-linear-gradient(45deg,#1a1a1a,#1a1a1a 8px,#222 8px,#222 16px)"></div>';
  return `<button class="cape${active ? ' on' : ''}" data-act="setcape" data-id="${c ? esc(c.id) : ''}" aria-label="${esc(label)}${active ? ' (equipped)' : ''}">${thumb}<span>${esc(label)}</span></button>`;
}

function accountView() {
  const capes = account.capes.length
    ? `<div style="display:flex;gap:14px;flex-wrap:wrap">${[null, ...account.capes].map((c) => capeTile(c)).join('')}</div>`
    : '<div class="c empty" style="background:#0f0f0f">This account does not own any capes yet.</div>';
  return `<div style="display:grid;grid-template-columns:320px 1fr;gap:24px"><section class="c pad24" style="text-align:center"><div style="background:#0d0d0d;border-radius:16px;padding:16px;display:inline-block">${skinPreview()}</div>
<div style="font-weight:700;font-size:18px;margin:14px 0">${esc(account.name)}</div><button class="b" data-act="signout">Sign out</button>
${account.canRemember ? '' : '<div class="muted" style="margin-top:10px">This computer cannot store sign-ins safely, so you will sign in each time you open Ember.</div>'}</section>
<section class="c pad24"><div style="font-weight:700">Your capes</div><div class="muted" style="margin:6px 0 16px">Pick a cape to wear it in game. It changes on your Minecraft account right away.</div>${capes}</section></div>`;
}

function offlineCard() {
  const has = !!account.offlineName;
  return `<section class="c pad24"><div style="font-weight:700;margin-bottom:6px">Play offline</div>
<div class="muted" style="margin-bottom:14px">No sign-in needed, just pick a username. This works for singleplayer and offline-mode servers. You will not get your skin or capes, and online servers (including servers hosted in Ember) will not let you in.</div>
<form id="offlineform" class="row" style="gap:12px"><input type="text" id="offname" placeholder="Username" autocomplete="off" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" title="3 to 16 letters, numbers or underscores" value="${esc(account.offlineName)}"><button class="b g">${has ? 'Save' : 'Use offline'}</button>${has ? '<button type="button" class="b" data-act="clearoffline">Remove</button>' : ''}</form>
${has ? `<div class="muted" style="margin-top:10px">Playing as <b>${esc(account.offlineName)}</b>.</div>` : ''}</section>`;
}

function pageSkins() {
  const body = !account.clientIdSet ? setupCard() : !account.signedIn ? signInCard() : accountView();
  return `<div class="stack" style="max-width:900px"><h1>Skins &amp; capes</h1>${body}${account.signedIn ? '' : offlineCard()}</div>`;
}


function friendAddr(h) {
  const a = (h.publicAddress || '').trim();
  if (!a) return '';
  return a.includes(':') || h.port === 25565 ? a : `${a}:${h.port}`;
}


function inviteText(h) {
  return `Join my Minecraft server!\nMinecraft Java Edition, version ${h.version}\nServer address: ${friendAddr(h)}\n\n1. Open Minecraft (Java Edition) and choose version ${h.version}.\n2. Click Multiplayer, then Add Server.\n3. Paste the server address above, click Done, then join.\n\nSend me your Minecraft username first, so I can add you to the whitelist.`;
}

function showGuide(h) {
  const port = h ? h.port : 25565;
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="guide"><div class="row"><h2 style="margin:0">Let friends on other Wi-Fi join</h2><button class="b" data-act="closemodal">Close</button></div>
<p class="muted">Your server runs on your computer. A free service called playit.gg gives it an address that friends can reach from anywhere. The playit website changes now and then, so some buttons may look a little different.</p>
<h3>Part 1: you (the host)</h3><ol>
<li>In Ember, open <b>Host a server</b>, make your server, and press <b>Start</b>. Wait until the console shows a line with the word <b>Done</b>. It can take a minute.</li>
<li>In the <b>Let friends join</b> box, press <b>Start tunnel</b>. Ember downloads the playit program and runs it. If it cannot, press <b>Open playit.gg</b> and download the Windows program yourself.</li>
<li>A link appears in Ember. Press <b>Open link</b>, make a free account (check your email to verify it), and click <b>Add Agent</b>.</li>
<li>On the playit website, click <b>Create Tunnel</b>. Give it any name, choose <b>Minecraft Java</b>, and pick the free option. Keep the local address as <b>127.0.0.1</b> and the local port as <b>${port}</b>. Then create it.</li>
<li>Ember tries to find your tunnel address and save it for you. If it does not, copy the address from the playit website. It looks like <b>something.at.ply.gg:12345</b>. Paste it into <b>Address friends type</b> in Settings and press <b>Save settings</b>.</li>
<li>Press <b>Copy invite message</b> and send it to your friends in a text or chat.</li>
<li>Ask each friend for their Minecraft username. Type it in the whitelist box in Ember and press <b>Add to whitelist</b>. The server must be running.</li></ol>
<p class="muted">Keep your server running and the tunnel running in Ember the whole time friends play. Stopping the tunnel, or closing Ember, ends it.</p>
<h3>Part 2: your friends</h3><ol>
<li>Open Minecraft Java Edition and choose the same version as your server.</li>
<li>Click <b>Multiplayer</b>, then <b>Add Server</b>.</li>
<li>Paste the address from your invite message, click <b>Done</b>, and join.</li></ol>
<h3>If a friend cannot join</h3><ol>
<li>Check that the server shows Running in Ember and the playit program is still open.</li>
<li>Check that the port in playit matches the port in Ember.</li>
<li>Check that the friend is on the whitelist and spelled their username correctly.</li>
<li>Check that the friend uses the same Minecraft version as the server.</li>
<li>Some internet providers block playit addresses. The friend can try a phone hotspot or a VPN.</li></ol></div>`;
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
}


function tunnelBlock(h) {
  const t = tunnel;
  const differs = t.address && h.publicAddress !== t.address;
  return `<div style="margin-top:14px;padding-top:14px;border-top:1px solid #232323"><div class="row"><div><div style="font-weight:700">Automatic tunnel <span class="muted">(beta)</span></div><div class="muted">Ember runs playit for you. ${t.running ? '<b style="color:var(--g)">Running</b>' : 'Stopped'}</div></div>${t.running ? '<button class="b" data-act="tunnelstop">Stop tunnel</button>' : '<button class="b g" data-act="tunnelstart">Start tunnel</button>'}</div>
${t.claim ? '<div class="muted" style="margin-top:10px">Open this link to connect playit to a free account, then create a Minecraft Java tunnel. <button class="b" style="min-height:36px;padding:0 12px" data-act="claimopen">Open link</button></div>' : ''}
${t.address ? `<div style="margin-top:10px">Tunnel address: <b>${esc(t.address)}</b> ${differs ? `<button class="b" style="min-height:36px;padding:0 12px" data-act="useaddr" data-id="${h.id}">Use this address</button>` : ''}</div>` : ''}
${t.hint ? '<div class="muted" style="margin-top:10px">Ember could not read a link or address from playit. Stop the tunnel, then press <b>Open playit in its own window</b>, or follow the guide.</div>' : ''}
${t.running || t.log.length ? `<div id="tunnellog" class="console" style="height:110px;margin-top:10px">${esc(t.log.join('\n'))}</div>` : ''}
${t.running ? '' : '<button class="b" style="margin-top:10px" data-act="tunnelwindow">Open playit in its own window</button>'}</div>`;
}

function hostCard(h) {
  return `<div class="c pad" data-act="hostsel" data-id="${h.id}" style="cursor:pointer${h.id === hostSel ? ';border-color:var(--a)' : ''}"><div class="row"><div><div style="font-weight:700">${esc(h.name)}</div><div class="muted" style="margin-top:4px">Minecraft ${esc(h.version)} · port ${h.port}</div><div style="margin-top:6px;font-size:12px;font-weight:700;color:${h.running ? 'var(--g)' : '#9a9a9a'}">${h.running ? 'Running' : 'Stopped'}</div></div>${h.running ? `<button class="b" data-act="hoststop" data-id="${h.id}">Stop</button>` : `<button class="b g" data-act="hoststart" data-id="${h.id}">Start</button>`}</div></div>`;
}

function hostDetail(h) {
  const lan = net.length ? net.map((ip) => `<b>${esc(ip)}${h.port === 25565 ? '' : ':' + h.port}</b>`).join(', ') : 'not found';
  const fa = friendAddr(h);
  return `<section class="c pad20"><div class="row"><div style="font-weight:700">Console</div><div style="display:flex;gap:8px"><button class="b" data-act="hostbackup" data-id="${h.id}" ${h.running ? 'disabled' : ''}>Back up to a folder</button><button class="b" data-act="hostfolder" data-id="${h.id}">Open folder</button></div></div>
<div id="console" class="console" style="margin-top:12px">${esc((logs[h.id] || []).join('\n'))}</div>
<form id="cmdform" class="row" style="margin-top:12px"><input type="text" id="cmd" placeholder="${h.running ? 'Type a command, like: say hello' : 'Start the server to send commands'}" ${h.running ? '' : 'disabled'} maxlength="200"><button class="b" ${h.running ? '' : 'disabled'}>Send</button></form></section>
<section class="c pad20"><div style="font-weight:700;margin-bottom:6px">Let friends join</div>
<div class="muted">Same Wi-Fi or network: ${lan}</div>
<div class="muted" style="margin:10px 0">Friends on a different Wi-Fi: the easiest way is a free tunnel from playit.gg. It needs no router settings.</div>
<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="b o" data-act="guide" data-id="${h.id}">Step-by-step guide</button><button class="b" data-act="openplayit">Open playit.gg</button><button class="b" data-act="copyinvite" data-id="${h.id}">Copy invite message</button></div>
${tunnelBlock(h)}
<div class="muted" style="margin-top:10px">Other ways, which are harder: port forwarding or a VPN like Tailscale. <button type="button" class="b" style="min-height:36px;padding:0 12px" data-act="publicip" data-id="${h.id}">Look up my public IP</button> <span id="pubip"></span></div>
<form id="wlform" class="row" style="margin-top:14px"><input type="text" id="wl" placeholder="Friend's Minecraft username" maxlength="16"><button class="b g" ${h.running ? '' : 'disabled'}>Add to whitelist</button></form>
<div class="muted" style="margin-top:6px">Whitelist is on by default, so only people you add can join. The server must be running to add someone.</div></section>
<form id="hostform" class="c pad20" data-id="${h.id}"><div style="font-weight:700;margin-bottom:12px">Settings</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
<label class="field"><span>Name</span><input type="text" name="name" value="${esc(h.name)}" maxlength="40" required></label>
<label class="field"><span>Port</span><input type="text" name="port" value="${h.port}"></label>
<label class="field"><span>Max players</span><input type="text" name="maxPlayers" value="${h.maxPlayers}"></label>
<label class="field"><span>Memory (MB)</span><input type="text" name="ram" value="${h.ram}"></label></div>
<label class="field"><span>Message shown in the server list</span><input type="text" name="motd" value="${esc(h.motd)}" maxlength="100"></label>
<label class="field"><span>Address friends type (your tunnel address or domain)</span><div class="row"><input type="text" name="publicAddress" value="${esc(h.publicAddress || '')}" maxlength="120" placeholder="example.at.ply.gg:12345"><button type="button" class="b" data-act="copyaddr" data-id="${h.id}" ${fa ? '' : 'disabled'}>Copy</button></div></label>
<label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="whitelist" ${h.whitelist ? 'checked' : ''}><span style="margin:0">Whitelist (only people you add can join)</span></label>
<label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="eula" ${h.eula ? 'checked' : ''}><span style="margin:0">I accept the Minecraft EULA</span><button type="button" class="b" data-act="eula">Read it</button></label>
<div class="row"><button type="button" class="b" data-act="hostdelete" data-id="${h.id}" ${h.running ? 'disabled' : ''}>Delete server</button><button class="b g">Save settings</button></div>
<div class="muted" style="margin-top:8px">Changes apply the next time the server starts. Sign-in checks stay on, so only real Minecraft accounts can join.</div></form>`;
}

function pageHost() {
  const sel = hosted.find((h) => h.id === hostSel);
  const left = hosted.length
    ? hosted.map(hostCard).join('')
    : '<div class="c empty">No servers yet. Create one and it runs on this computer.</div>';
  return `<div class="stack"><div class="row"><h1>Host a server</h1><button class="b g" data-act="newhost">New server</button></div>
<div style="display:grid;grid-template-columns:300px 1fr;gap:24px;align-items:start"><div class="stack">${left}</div><div class="stack">${sel ? hostDetail(sel) : '<div class="c empty">Pick a server on the left, or create a new one.</div>'}</div></div></div>`;
}

function render(animate) {
  applyColors();
  renderNav();
  const pages = { home: pageHome, profiles: pageProfiles, appearance: pageAppearance, skins: pageSkins, host: pageHost };
  const view = $('#view');
  view.innerHTML = pages[route]();
  if (animate) { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); }
  drawSkins();
  const con = $('#console');
  if (con) con.scrollTop = con.scrollHeight;
}

/* ---------- modals ---------- */

function modal(html, onSubmit, label = 'Save') {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<form>${html}<div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="b" data-act="closemodal">Cancel</button><button type="submit" class="b g">${esc(label)}</button></div></form>`;
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  m.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit(Object.fromEntries(new FormData(e.target)));
    m.remove();
  });
  document.body.appendChild(m);
  const first = m.querySelector('input');
  if (first) first.focus();
}

async function newProfile() {
  let list = null;
  try { list = (await window.api.host.versions()).releases; } catch { list = null; }
  const ver = list
    ? `<select name="version">${list.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>`
    : '<input type="text" name="version" value="1.21.1" required maxlength="20">';
  modal(`<h2 style="margin:0 0 16px">New profile</h2>
<label class="field"><span>Name</span><input type="text" name="name" required maxlength="40"></label>
<label class="field"><span>Minecraft version</span>${ver}</label>
<label class="field"><span>Mod loader</span><select name="loader"><option value="vanilla">Vanilla</option><option value="fabric">Fabric</option></select></label>
<div class="muted" style="margin-bottom:8px">Forge and NeoForge are not supported yet.</div>`, (f) => {
    state.profiles.push({ id: uid(), name: f.name.trim() || 'Profile', version: f.version.trim(), loader: f.loader, lastPlayed: null, photo: null });
    save(); render();
  });
}

function newServer() {
  modal(`<h2 style="margin:0 0 16px">Add server</h2>
<label class="field"><span>Name</span><input type="text" name="name" required maxlength="40"></label>
<label class="field"><span>Address</span><input type="text" name="address" required maxlength="100" placeholder="play.example.net"></label>`, (f) => {
    state.servers.push({ id: uid(), name: f.name.trim(), address: f.address.trim(), fav: true });
    save(); render();
  });
}


async function newHost() {
  let v;
  try { v = await window.api.host.versions(); } catch (e) { toast(errMsg(e)); return; }
  modal(`<h2 style="margin:0 0 16px">New server</h2>
<label class="field"><span>Name</span><input type="text" name="name" required maxlength="40" value="My server"></label>
<label class="field"><span>Minecraft version</span><select name="version">${v.releases.map((r) => `<option value="${esc(r)}"${r === v.latest ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 12px"><label class="field"><span>Port</span><input type="text" name="port" value="25565"></label><label class="field"><span>Max players</span><input type="text" name="maxPlayers" value="10"></label><label class="field"><span>Memory (MB)</span><input type="text" name="ram" value="2048"></label></div>
<label class="field"><span>Message shown in the server list</span><input type="text" name="motd" value="A Minecraft server" maxlength="100"></label>
<label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="whitelist" checked><span style="margin:0">Whitelist (only people you add can join)</span></label>
<label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="eula" required><span style="margin:0">I accept the Minecraft EULA</span><button type="button" class="b" data-act="eula">Read it</button></label>`, async (f) => {
    toast('Creating server. Downloading it from Mojang...');
    try {
      const cfg = await window.api.host.create({ name: f.name, version: f.version, port: f.port, maxPlayers: f.maxPlayers, ram: f.ram, motd: f.motd, whitelist: !!f.whitelist, eula: !!f.eula, publicAddress: '' });
      hosted.push({ ...cfg, running: false });
      hostSel = cfg.id;
      toast('Server ready. Press Start.');
      if (route === 'host') render();
    } catch (e) { toast(errMsg(e)); }
  });
}


function askOfflineName(then) {
  modal(`<h2 style="margin:0 0 8px">Choose a username</h2>
<div class="muted" style="margin-bottom:16px">You are not signed in, so Ember will play in offline mode. That works for singleplayer and offline-mode servers. For your real account, skin and capes, sign in with Microsoft on the Skins &amp; capes page.</div>
<label class="field"><span>Username</span><input type="text" name="name" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" title="3 to 16 letters, numbers or underscores" autocomplete="off"></label>`, (f) => {
    window.api.auth.setOffline(f.name)
      .then((acc) => { account = acc; render(); then(); })
      .catch((e) => toast(errMsg(e)));
  }, 'Play offline');
}

async function playProfile(id, server) {
  const p = state.profiles.find((x) => x.id === id);
  if (!p) return;
  if (account.mode === 'none') {
    askOfflineName(() => playProfile(id, server));
    return;
  }
  showProgress(p.name);
  try {
    await window.api.game.play({ profile: { id: p.id, version: p.version, loader: p.loader }, server });
    p.lastPlayed = Date.now();
    save();
  } catch (e) { toast(errMsg(e)); }
  hideProgress();
  render();
}

function showProgress(name) {
  hideProgress();
  const m = document.createElement('div');
  m.className = 'modal';
  m.id = 'progress';
  m.innerHTML = `<div class="guide" style="width:440px"><h2 style="margin:0 0 12px">Getting ${esc(name)} ready</h2><div id="ptext" class="muted">Starting...</div><div class="bar"><div id="pbar"></div></div><div class="muted" style="margin-top:12px">The first launch of a version downloads a lot. Next time it is quick.</div></div>`;
  document.body.appendChild(m);
}
function hideProgress() { const m = $('#progress'); if (m) m.remove(); }

function closeDeviceModal() { const m = $('#devicecode'); if (m) m.remove(); }
function showDeviceModal({ userCode, verificationUri }) {
  closeDeviceModal();
  const m = document.createElement('div');
  m.className = 'modal';
  m.id = 'devicecode';
  m.innerHTML = `<div class="guide" style="width:460px;text-align:center"><h2 style="margin:0 0 12px">Sign in with Microsoft</h2>
<p class="muted">Your browser should open. If it did not, go to <b>${esc(verificationUri)}</b> and enter this code:</p>
<div style="font-size:34px;font-weight:700;letter-spacing:6px;margin:16px 0">${esc(userCode)}</div>
<div class="row" style="justify-content:center;gap:12px"><button class="b" data-act="copycode" data-code="${esc(userCode)}">Copy code</button><button class="b" data-act="canceldevice">Cancel</button></div>
<p class="muted" style="margin-top:14px">Waiting for you to finish in the browser...</p></div>`;
  document.body.appendChild(m);
}

function showAuthGuide() {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="guide"><div class="row"><h2 style="margin:0">One-time setup for Microsoft sign-in</h2><button class="b" data-act="closemodal">Close</button></div>
<p class="muted">Minecraft only lets approved apps sign players in, so you register your own free app once and ask Mojang to approve it. The websites change now and then, so some labels may look a little different.</p>
<ol>
<li>Press <b>Open Azure</b> and sign in with any Microsoft account.</li>
<li>Search for <b>App registrations</b> and click <b>New registration</b>.</li>
<li>Name it <b>Ember</b>. For account types choose <b>Personal Microsoft accounts only</b>. Leave the redirect address empty and click <b>Register</b>.</li>
<li>Open <b>Authentication</b>, find <b>Allow public client flows</b>, set it to <b>Yes</b>, and save.</li>
<li>On the Overview page, copy the <b>Application (client) ID</b>.</li>
<li>Press <b>Open the Minecraft Wiki page</b>. It links Mojang's form for asking them to approve an app ID. Fill it in with your ID. Approval can take a while.</li>
<li>Paste the ID into Ember (Skins &amp; capes page) and press <b>Save ID</b>. Once Mojang approves it, <b>Sign in with Microsoft</b> works.</li></ol>
<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="b o" data-act="openazure">Open Azure</button><button class="b" data-act="openwiki">Open the Minecraft Wiki page</button></div>
<p class="muted">Until Mojang approves the ID, sign-in is refused with a message saying so. Nothing is wrong with Ember when that happens.</p></div>`;
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
}

/* ---------- events ---------- */

const actions = {
  go: (d) => {
    route = d.route;
    render(true);
    if (route === 'host') window.api.host.network().then((n) => { net = n; if (route === 'host') render(); }).catch(() => {});
  },
  tunnelstart: () => {
    tunnel.hint = false; tunnel.claim = ''; tunnel.address = ''; tunnel.log = [];
    clearTimeout(tunnel.timer);
    tunnel.timer = setTimeout(() => { if (tunnel.running && !tunnel.claim && !tunnel.address) { tunnel.hint = true; if (route === 'host') render(); } }, 25000);
    window.api.host.tunnelStart().catch((e) => { clearTimeout(tunnel.timer); toast(errMsg(e)); });
  },
  tunnelstop: () => window.api.host.tunnelStop(),
  tunnelwindow: () => window.api.host.tunnelWindow().catch((e) => toast(errMsg(e))),
  claimopen: () => window.api.host.openClaim(tunnel.claim).catch((e) => toast(errMsg(e))),
  useaddr: (d) => {
    const h = hosted.find((x) => x.id === d.id);
    if (h) window.api.host.update(h.id, { publicAddress: tunnel.address }).then((cfg) => { Object.assign(h, cfg); toast('Address saved.'); render(); }).catch((e) => toast(errMsg(e)));
  },
  newhost: newHost,
  guide: (d) => showGuide(hosted.find((x) => x.id === d.id)),
  openplayit: () => window.api.host.openPlayit(),
  copyinvite: (d) => {
    const h = hosted.find((x) => x.id === d.id);
    if (!h) return;
    if (!friendAddr(h)) { toast('First add your tunnel address in Settings. The guide shows how.'); return; }
    navigator.clipboard.writeText(inviteText(h)).then(() => toast('Invite message copied. Paste it to your friends.'), () => toast('Could not copy.'));
  },
  hostsel: (d) => { hostSel = d.id; render(); },
  hoststart: (d) => {
    toast('Starting. The first time can take a few minutes if Java has to download.');
    hostSel = d.id;
    if (route === 'host') render();
    window.api.host.start(d.id).catch((e) => toast(errMsg(e)));
  },
  hoststop: (d) => window.api.host.stop(d.id).catch((e) => toast(errMsg(e))),
  hostfolder: (d) => window.api.host.openFolder(d.id),
  hostbackup: (d) => {
    toast('Backing up. This can take a moment for big worlds.');
    window.api.host.backup(d.id).then((dest) => { if (dest) toast('Backup saved to ' + dest); }).catch((e) => toast(errMsg(e)));
  },
  eula: () => window.api.host.openEula(),
  hostdelete: (d) => {
    if (!confirm('Delete this server and its world? This cannot be undone.')) return;
    window.api.host.remove(d.id).then(() => { hosted = hosted.filter((h) => h.id !== d.id); if (hostSel === d.id) hostSel = null; render(); }).catch((e) => toast(errMsg(e)));
  },
  copyaddr: (d) => {
    const h = hosted.find((x) => x.id === d.id);
    if (h) navigator.clipboard.writeText(friendAddr(h)).then(() => toast('Address copied.'), () => toast('Could not copy.'));
  },
  publicip: (d) => {
    const h = hosted.find((x) => x.id === d.id);
    window.api.host.publicIp().then((ip) => { const el = $('#pubip'); if (el && h) el.textContent = `Your public IP: ${ip}${h.port === 25565 ? '' : ':' + h.port}`; }).catch((e) => toast(errMsg(e)));
  },
  play: (d) => playProfile(d.id),
  join: (d) => {
    const s = state.servers.find((x) => x.id === d.id);
    const p = [...state.profiles].sort((x, y) => (y.lastPlayed || 0) - (x.lastPlayed || 0))[0];
    if (!s) return;
    if (!p) { toast('Make a profile first, then join.'); return; }
    s.lastJoined = Date.now();
    save();
    playProfile(p.id, s.address);
  },
  stopgame: (d) => window.api.game.stop(d.id),
  profilefolder: (d) => window.api.game.openFolder(d.id),
  signin: () => {
    window.api.auth.signIn()
      .then((acc) => { account = acc; closeDeviceModal(); toast('Signed in as ' + acc.name); render(); })
      .catch((e) => { closeDeviceModal(); toast(errMsg(e)); });
  },
  canceldevice: () => { window.api.auth.cancel(); closeDeviceModal(); },
  copycode: (d) => navigator.clipboard.writeText(d.code).then(() => toast('Code copied.'), () => {}),
  signout: () => window.api.auth.signOut().then((acc) => { account = acc; render(); }),
  clearoffline: () => window.api.auth.clearOffline().then((acc) => { account = acc; render(); toast('Offline username removed.'); }).catch((e) => toast(errMsg(e))),
  changeclient: () => { account.clientIdSet = false; render(); },
  authguide: showAuthGuide,
  openazure: () => window.api.auth.open('azure'),
  openwiki: () => window.api.auth.open('wiki'),
  setcape: (d) => window.api.auth.setCape(d.id || null)
    .then((acc) => { account = acc; render(); toast(d.id ? 'Cape changed.' : 'Cape removed.'); })
    .catch((e) => toast(errMsg(e))),
  newprofile: newProfile,
  newserver: newServer,
  closemodal: (_d, el) => el.closest('.modal').remove(),
  fav: (d) => { const s = state.servers.find((x) => x.id === d.id); if (s) { s.fav = !s.fav; save(); render(); } },
  delserver: (d) => { state.servers = state.servers.filter((x) => x.id !== d.id); save(); render(); },
  delprofile: (d) => { if (confirm('Delete this profile from the launcher?')) { state.profiles = state.profiles.filter((x) => x.id !== d.id); save(); render(); } },
  photo: async (d) => {
    const url = await window.api.pickPhoto();
    const p = state.profiles.find((x) => x.id === d.id);
    if (url && p) { p.photo = url; save(); render(); }
  },
  preset: (d) => { const [a, g] = PRESETS[Number(d.i)]; state.colors.accent = a; state.colors.action = g; save(); render(); },
  resetcolors: () => { state.colors = { accent: '#f97316', action: '#22c55e', bg: '#0a0a0a' }; save(); render(); }
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el.dataset, el);
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('input[data-color]')) {
    state.colors[t.dataset.color] = t.value;
    applyColors();
    save();
  } else if (t.id === 'search') {
    search = t.value;
    const pos = t.selectionStart;
    render();
    const again = $('#search');
    again.focus();
    again.setSelectionRange(pos, pos);
  }
});


document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.id === 'offlineform') {
    e.preventDefault();
    window.api.auth.setOffline($('#offname').value)
      .then((acc) => { account = acc; render(); toast('Offline username saved: ' + acc.offlineName); })
      .catch((err) => toast(errMsg(err)));
    return;
  }
  if (f.id === 'clientform') {
    e.preventDefault();
    window.api.auth.setClient($('#clientid').value).then((acc) => { account = acc; render(); toast('App ID saved.'); }).catch((err) => toast(errMsg(err)));
    return;
  }
  const h = hosted.find((x) => x.id === hostSel);
  if (!h) return;
  if (f.id === 'cmdform') {
    e.preventDefault();
    const i = $('#cmd');
    const v = i.value.trim();
    if (!v) return;
    window.api.host.command(h.id, v).then(() => { i.value = ''; }).catch((err) => toast(errMsg(err)));
  } else if (f.id === 'wlform') {
    e.preventDefault();
    const i = $('#wl');
    window.api.host.whitelist(h.id, i.value.trim()).then(() => { toast('Added ' + i.value.trim()); i.value = ''; }).catch((err) => toast(errMsg(err)));
  } else if (f.id === 'hostform') {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    window.api.host.update(h.id, { name: d.name, port: d.port, maxPlayers: d.maxPlayers, ram: d.ram, motd: d.motd, publicAddress: d.publicAddress, whitelist: !!d.whitelist, eula: !!d.eula })
      .then((cfg) => { Object.assign(h, cfg); toast(h.running ? 'Saved. Restart the server to apply.' : 'Saved.'); render(); })
      .catch((err) => toast(errMsg(err)));
  }
});

window.api.host.onLog(({ id, line }) => {
  const arr = (logs[id] = logs[id] || []);
  arr.push(line);
  if (arr.length > 500) arr.shift();
  const con = $('#console');
  if (con && route === 'host' && hostSel === id) {
    con.textContent += line + '\n';
    con.scrollTop = con.scrollHeight;
  }
});
window.api.host.onStatus(({ id, running }) => {
  const h = hosted.find((x) => x.id === id);
  if (h) h.running = running;
  if (route === 'host') render();
});

window.api.host.onTunnelStatus(({ running }) => {
  tunnel.running = running;
  if (!running) clearTimeout(tunnel.timer);
  if (route === 'host') render();
});
window.api.host.onTunnelLog(({ line }) => {
  if (tunnel.log[tunnel.log.length - 1] === line) return;
  tunnel.log.push(line);
  if (tunnel.log.length > 150) tunnel.log.shift();
  const el = $('#tunnellog');
  if (el && route === 'host') { el.textContent += line + '\n'; el.scrollTop = el.scrollHeight; }
});
window.api.host.onTunnel((f) => {
  clearTimeout(tunnel.timer);
  tunnel.hint = false;
  if (f.claim) tunnel.claim = f.claim;
  if (f.address) {
    tunnel.address = f.address;
    const h = hosted.find((x) => x.id === hostSel);
    if (h && !h.publicAddress) {
      window.api.host.update(h.id, { publicAddress: f.address }).then((cfg) => { Object.assign(h, cfg); toast('Tunnel address found and saved.'); render(); }).catch(() => {});
      return;
    }
  }
  if (route === 'host') render();
});

window.api.auth.onCode(showDeviceModal);
window.api.game.onProgress(({ text, pct }) => {
  const t = $('#ptext');
  if (t) t.textContent = text;
  const b = $('#pbar');
  if (b) b.style.width = pct + '%';
});
window.api.game.onStatus(({ profileId, running, code }) => {
  if (running) playing[profileId] = true; else delete playing[profileId];
  if (!running && code) toast('Minecraft closed with an error. Open the profile Files button and look at ember-launch.log.');
  if (route === 'home' || route === 'profiles') render();
});
window.api.game.onPhoto(({ profileId, url }) => {
  const p = state.profiles.find((x) => x.id === profileId);
  if (!p) return;
  p.photo = url;
  save();
  if (route === 'home' || route === 'profiles') render();
  toast('World photo updated from your newest screenshot.');
});

Promise.all([window.api.getState(), window.api.host.list(), window.api.host.tunnelInfo(), window.api.auth.status(), window.api.game.running()]).then(([s, l, ti, acc, run]) => {
  state = s; hosted = l; tunnel.running = ti.running; account = acc;
  run.forEach((id) => { playing[id] = true; });
  render(true);
});
