const { app, BrowserWindow, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

let mainWindow;
let tray;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'BitMeet',
    icon: path.join(__dirname, '../public/favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  const url = isDev 
    ? 'http://localhost:4323' 
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(url);

  // Comportamiento de "cerrar" -> Minimizar al tray
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../public/favicon.ico'));
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir BitMeet', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Salir', click: () => {
      isQuitting = true;
      app.quit();
    }}
  ]);

  tray.setToolTip('BitMeet');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // En Mac es común que la app siga abierta sin ventanas
  }
});

// Notificaciones desde el renderizador (opcional, Capacitor/Web lo maneja, pero Electron puede potenciarlo)
const { ipcMain } = require('electron');
ipcMain.on('notify', (event, { title, body }) => {
  new Notification({ title, body }).show();
});
