import {
  app,
  BrowserWindow,
  session,
  shell,
  Menu,
  ipcMain,
  nativeImage,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { is } from '@electron-toolkit/utils'

const ICON_PATH = join(__dirname, '../../resources/icon.icns')

function setupGeminiSession(): void {
  const geminiSession = session.fromPartition('persist:gemini')

  // Allow all permissions: clipboard, camera, microphone, notifications, etc.
  geminiSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true)
  })

  geminiSession.setPermissionCheckHandler(() => true)

  // Auto-save downloads to ~/Downloads/
  geminiSession.on('will-download', (_event, item) => {
    const savePath = join(homedir(), 'Downloads', item.getFilename())
    item.setSavePath(savePath)
  })
}

function createAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const icon = nativeImage.createFromPath(ICON_PATH)

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'Gemini',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Handle new-window requests from the BrowserWindow itself
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Configure webview after it attaches: allow Google OAuth popups,
  // handle external links, and wire up per-webview download handling.
  win.webContents.on('did-attach-webview', (_event, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      if (
        url.startsWith('https://accounts.google.com') ||
        url.startsWith('https://gemini.google.com')
      ) {
        return { action: 'allow' }
      }
      shell.openExternal(url)
      return { action: 'deny' }
    })

    // Fallback: also catch downloads initiated from inside the webview
    wc.session.on('will-download', (_event2, item) => {
      const savePath = join(homedir(), 'Downloads', item.getFilename())
      if (!item.getSavePath()) {
        item.setSavePath(savePath)
      }
    })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// IPC: show native Copy/Paste context menu and relay action back to renderer
ipcMain.on('show-context-menu', (event, params: { selectionText: string; isEditable: boolean }) => {
  const { selectionText, isEditable } = params
  const items: MenuItemConstructorOptions[] = []

  if (selectionText?.length > 0 || !isEditable) {
    items.push({
      label: 'Copy',
      click: () => event.sender.send('context-menu-action', 'copy')
    })
  }

  if (isEditable) {
    if (items.length > 0) items.push({ type: 'separator' })
    items.push({
      label: 'Paste',
      click: () => event.sender.send('context-menu-action', 'paste')
    })
  }

  if (items.length === 0) {
    items.push(
      { label: 'Copy', click: () => event.sender.send('context-menu-action', 'copy') },
      { type: 'separator' },
      { label: 'Paste', click: () => event.sender.send('context-menu-action', 'paste') }
    )
  }

  const menu = Menu.buildFromTemplate(items)
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) menu.popup({ window: win })
})

app.whenReady().then(() => {
  setupGeminiSession()
  createAppMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
