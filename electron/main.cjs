const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;

let mainWindow;
let tray;
let isQuitting = false;

// Configuración básica del AutoUpdater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', () => {
  new Notification({
    title: 'BitMeet: Actualización disponible',
    body: 'Se está descargando una nueva versión automáticamente.'
  }).show();
});

autoUpdater.on('update-downloaded', () => {
  new Notification({
    title: 'BitMeet: Lista para instalar',
    body: 'La actualización se aplicará al reiniciar la aplicación.'
  }).show();
});

// Evitar múltiples instancias
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'BitMeet',
    icon: path.join(__dirname, '../resources/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false // Importante para que no se pause en segundo plano
    }
  });

  const url = isDev 
    ? 'http://localhost:4323' 
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(url);

  // Comportamiento de "cerrar" -> Ocultar la ventana
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // Notificar al usuario la primera vez que se oculta
      if (process.platform === 'win32' || process.platform === 'darwin') {
        const firstHide = !app.isDefaultProtocolClient('bitmeet-hidden-notice');
        if (firstHide) {
          new Notification({
            title: 'BitMeet sigue activo',
            body: 'La aplicación se ha minimizado a la bandeja del sistema.',
            icon: path.join(__dirname, '../resources/icon.png')
          }).show();
          // Marcamos que ya hemos avisado (usando un truco simple o localStorage en main)
        }
      }
    }
    return false;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../resources/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir BitMeet', click: () => {
      mainWindow.show();
      mainWindow.focus();
    }},
    { type: 'separator' },
    { label: 'Salir', click: () => {
      isQuitting = true;
      app.quit();
    }}
  ]);

  tray.setToolTip('BitMeet');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  
  // Buscar actualizaciones (solo en producción)
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  // Registrar protocolo para que las notificaciones puedan abrir la app
  if (!app.isDefaultProtocolClient('bitmeet')) {
    app.setAsDefaultProtocolClient('bitmeet');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

// Manejo de notificaciones desde el frontend
ipcMain.on('notify', (event, { title, body }) => {
  const notification = new Notification({ 
    title, 
    body,
    icon: path.join(__dirname, '../resources/icon.png')
  });
  
  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  
  notification.show();
});

// Canal para pedir permisos (Electron siempre los tiene, pero para mantener paridad)
ipcMain.handle('request-notification-permission', async () => {
  return 'granted';
});
