const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch) => (cb) => ipcRenderer.on(ch, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('api', {
  getState: call('state:get'),
  setState: call('state:set'),
  pickPhoto: call('photo:pick'),
  auth: {
    status: call('auth:status'),
    setClient: call('auth:setclient'),
    signIn: call('auth:signin'),
    cancel: call('auth:cancel'),
    signOut: call('auth:signout'),
    setOffline: call('auth:setoffline'),
    clearOffline: call('auth:clearoffline'),
    open: call('auth:open'),
    setCape: call('auth:setcape'),
    onCode: listen('auth:code')
  },
  game: {
    play: call('game:play'),
    stop: call('game:stop'),
    running: call('game:running'),
    openFolder: call('game:openfolder'),
    openLog: call('game:openlog'),
    onProgress: listen('game:progress'),
    onStatus: listen('game:status'),
    onPhoto: listen('game:photo')
  },
  host: {
    versions: call('host:versions'),
    list: call('host:list'),
    create: call('host:create'),
    update: call('host:update'),
    remove: call('host:remove'),
    start: call('host:start'),
    stop: call('host:stop'),
    command: call('host:command'),
    whitelist: call('host:whitelist'),
    network: call('host:network'),
    publicIp: call('host:publicip'),
    openFolder: call('host:openfolder'),
    backup: call('host:backup'),
    openEula: call('host:eula'),
    openPlayit: call('host:openplayit'),
    tunnelInfo: call('host:tunnelinfo'),
    tunnelStart: call('host:tunnelstart'),
    tunnelStop: call('host:tunnelstop'),
    tunnelWindow: call('host:tunnelwindow'),
    openClaim: call('host:openclaim'),
    onTunnel: listen('host:tunnel'),
    onTunnelLog: listen('host:tunnellog'),
    onTunnelStatus: listen('host:tunnelstatus'),
    onLog: listen('host:log'),
    onStatus: listen('host:status')
  }
});
