const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cplayerDesktop', Object.freeze({
  signIn: () => ipcRenderer.invoke('account:sign-in'),
  signOut: () => ipcRenderer.invoke('account:sign-out'),
  onSignedIn(callback) { ipcRenderer.on('account:signed-in', () => callback()); },
}));
