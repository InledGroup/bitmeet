const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendNotification: (title, body) => ipcRenderer.send('notify', { title, body }),
  requestNotificationPermission: () => ipcRenderer.invoke('request-notification-permission'),
  isElectron: true
});
