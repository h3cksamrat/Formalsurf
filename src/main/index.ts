import { app, shell, BrowserWindow, ipcMain, webContents, session, Session, Menu, protocol } from 'electron'
import path, { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import os from 'os'
import fs from 'fs'
// import { installExtension, REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
// import { installExtension as installExtensionDev, REACT_DEVELOPER_TOOLS } from "electron-extension-installer";
import { buildChromeContextMenu } from 'electron-chrome-context-menu'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, installExtension, updateExtensions } from 'electron-chrome-web-store'
import { template } from './menubar'

let mainWindow;
let sharedSession
let extensions

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'surf',
    privileges: {
      standard: true,
      secure: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

async function createWindow(): Promise<void> {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 15 },
    autoHideMenuBar: true,
    vibrancy: 'sidebar',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true,
      nodeIntegration: true,
      contextIsolation: true,
    }
  })

  // Set up menu
  // @ts-expect-error
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  // Set up permission handling
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowedPermissions = ['media']
      if (allowedPermissions.includes(permission)) {
        callback(true)
      } else {
        callback(false)
      }
    }
  )

  // Main window handlers
  mainWindow.webContents.on('did-attach-webview', (_, contents) => {
    contents.setWindowOpenHandler((details) => {
      console.log("Opening URL (window):", details.url)
      mainWindow.webContents.send('open-url', details.url)
      return { action: 'deny' }
    })
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // IPC events
  ipcMain.on('toggle-traffic-lights', (_event, show) => {
    // Check if the platform supports window button visibility
    if (process.platform === 'darwin' && mainWindow?.setWindowButtonVisibility) {
      if (show) {
        mainWindow.setWindowButtonVisibility(true)
        console.log('Show traffic lights')
      } else {
        mainWindow.setWindowButtonVisibility(false)
        console.log('Hide traffic lights')
      }
    } else {
      console.log('Window button visibility not supported on this platform')
    }
  })

  ipcMain.handle('get-active-tab', async (_event, webContentsId) => {
    console.log('get-active-tab', webContentsId)
    return extensions.selectTab(webContents.fromId(webContentsId) as any)
  })

  ipcMain.handle('close-tab', async (_event, webContentsId) => {
    console.log('close-tab', webContentsId)
    return extensions.closeTab(webContents.fromId(webContentsId) as any)
  })

  ipcMain.handle('get-version', async (_event) => {
    const version = app.getVersion()
    const platform = os.platform();

    // Get the architecture (e.g., 'arm64' for ARM64)
    const architecture = process.arch;

    const systemInfo = `${version} ${platform} ${architecture}`;

    return systemInfo
  })


  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.formalsnake')

  sharedSession = session.fromPartition('persist:webview')

  const modulePathExtensions = path.join(app.getAppPath(), 'node_modules/electron-chrome-extensions')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // app handlers
  app.on('open-url', (event, url) => {
    event.preventDefault()
    console.log("Handling URL:", url)

    const existingWindow = BrowserWindow.getAllWindows()[0]
    if (existingWindow) {
      console.log("Existing window found, sending URL to it")
      existingWindow.webContents.send('open-url', url)
    } else {
      console.log("No existing window found, creating new window")
      // If no window exists, create one and wait for it to be ready
      createWindow().then(() => {
        const window = BrowserWindow.getAllWindows()[0]
        if (window) {
          window.webContents.send('open-url', url)
        }
      })
    }
  })

  // Extensions

  extensions = new ElectronChromeExtensions({
    license: "GPL-3.0",
    session: sharedSession,
    modulePath: modulePathExtensions,
    createTab(details) {
      // use the existing open-url function to open the new tab
      const window = BrowserWindow.getAllWindows()[0]
      if (window) {
        window.webContents.send('open-url', details.url)
      }
      // return the webContents and the window
      return [window.webContents, window]
    },
    createWindow(details) {
      const window = new BrowserWindow()
      return window
    },
    removeTab(tab, browserWindow) {
      browserWindow.webContents.send('remove-tab', tab)
    }
  })

  const modulePathWebstore = path.join(app.getAppPath(), 'node_modules/electron-chrome-web-store')

  await installChromeWebStore({ session: sharedSession, modulePath: modulePathWebstore }).catch((e) => console.error(e));

  // Check and install updates for all loaded extensions
  await updateExtensions()

  createWindow()

  app.on('activate', function() {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('web-contents-created', (event, webContents) => {
  if (webContents.getType() == 'webview') {
    const existingWindow = BrowserWindow.getAllWindows()[0]

    extensions.addTab(webContents, existingWindow)
    console.log("Tab", webContents.id)

    webContents.setVisualZoomLevelLimits(1, 4)

    // Handle new window events (e.g., links with target="_blank")
    webContents.on('new-window', (event, url) => {
      event.preventDefault() // Prevent the default behavior
      existingWindow.webContents.send('open-url', url) // Send the URL to the renderer process
    })

    webContents.on('context-menu', (_e, params) => {
      const menu = buildChromeContextMenu({
        params,
        webContents,
        extensionMenuItems: extensions.getContextMenuItems(webContents, params),
        openLink: (url, _disposition) => {
          existingWindow.webContents.send('open-url', url)
        }
      })

      menu.popup()
    })
  }
})

const newUserAgent = app.userAgentFallback
  .replace(
    /Chrome\/[\d.]+/,
    'Chrome/130.0.0.0' // Example: Update to a recent Chrome version
  )
  .replace(/Electron\/[\d.]+/, '')
  .replace(/formalsurf\/[\d.]+/, '')

// also replace Electron/* with nothing, and replace formalsurf-refactor/* with nothing
app.userAgentFallback = newUserAgent // app.userAgentFallback = newUserAgent

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
