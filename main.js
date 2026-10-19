const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const hosting = require('./hosting');
const auth = require('./auth');
const game = require('./game');

let mainWin = null;

const defaults = {
  username: '',
  colors: { accent: '#f97316', action: '#22c55e', bg: '#0a0a0a' },
  profiles: [],
  servers: []
};
const stateFile = () => path.join(app.getPath('userData'), 'launcher-state.json');

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return { ...defaults, ...saved, colors: { ...defaults.colors, ...(saved.colors || {}) } };
  } catch {
    return JSON.parse(JSON.stringify(defaults));
  }
}

function saveState(state) {
  const tmp = stateFile() + '.tmp';
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFile());
}

ipcMain.handle('state:get', () => loadState());
ipcMain.handle('state:set', (_e, state) => { saveState(state); return true; });

ipcMain.handle('photo:pick', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Choose a world photo',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const dir = path.join(app.getPath('userData'), 'photos');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, Date.now() + path.extname(res.filePaths[0]).toLowerCase());
  fs.copyFileSync(res.filePaths[0], dest);
  return pathToFileURL(dest).href;
});

function createWindow() {
  const win = mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#0a0a0a',
    title: 'Ember Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

const getWindow = () => mainWin;
const host = hosting.register({ app, ipcMain, shell, dialog, getWindow });
const account = auth.register({ app, ipcMain, shell, safeStorage, getWindow });
game.register({ app, ipcMain, shell, getWindow, getSession: account.getSession, ensureJava: host.ensureJava, extractZip: hosting.extractZip });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
