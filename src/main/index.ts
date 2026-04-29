import {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  shell,
  Menu,
  nativeImage,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { is } from '@electron-toolkit/utils'

const ICON_PATH = join(__dirname, '../../resources/icon.icns')
const GEMINI_URL = 'https://gemini.google.com/app'
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// Prevent Chromium from advertising automation mode — Google sign-in checks for this flag
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')

function setupGeminiSession(): void {
  const geminiSession = session.fromPartition('persist:gemini')

  // Set UA at session level so HTTP request headers carry the spoofed UA, not just navigator.userAgent
  geminiSession.setUserAgent(CHROME_UA)

  // Preload runs before any page script in ALL pages/popups using this session (including OAuth windows)
  const preloadPath = app.isPackaged
    ? join(process.resourcesPath, 'webview-preload.js')
    : join(__dirname, '../../resources/webview-preload.js')
  geminiSession.setPreloads([preloadPath])

  geminiSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true)
  })
  geminiSession.setPermissionCheckHandler(() => true)

  geminiSession.on('will-download', (_event, item) => {
    item.setSavePath(join(homedir(), 'Downloads', item.getFilename()))
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

function createWindow(): void {
  const icon = nativeImage.createFromPath(ICON_PATH)

  // Shell window — renders only the React loading screen
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'Gemini',
    icon,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
      // No webviewTag — Gemini runs in a WebContentsView instead
    }
  })

  // Show shell window as soon as the React loading screen is painted
  win.once('ready-to-show', () => win.show())

  // External links from the shell window open in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // ── Gemini content view ───────────────────────────────────────────────────
  // WebContentsView is a first-class Chromium renderer — NOT a guest WebView.
  // Google's sign-in blocks embedded WebViews (<webview> tag) but allows this.
  const geminiView = new WebContentsView({
    webPreferences: {
      partition: 'persist:gemini',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.contentView.addChildView(geminiView)

  let geminiReady = false

  const contentSize = (): { width: number; height: number } => {
    const [width, height] = win.getContentSize()
    return { width, height }
  }

  const showGemini = (): void => {
    const { width, height } = contentSize()
    geminiView.setBounds({ x: 0, y: 0, width, height })
  }

  const hideGemini = (): void => {
    geminiView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }

  // Keep geminiView filling the client area on every window resize
  const onResize = (): void => {
    if (geminiReady) showGemini()
  }
  win.on('resize', onResize)
  win.on('enter-full-screen', onResize)
  win.on('leave-full-screen', onResize)

  // Navigation started — hide Gemini, reveal loading screen
  geminiView.webContents.on('did-start-loading', () => {
    geminiReady = false
    hideGemini()
    win.webContents.send('loading-changed', true)
  })

  // Navigation finished — expand Gemini over the loading screen
  geminiView.webContents.on('did-stop-loading', () => {
    geminiReady = true
    showGemini()
    win.webContents.send('loading-changed', false)
  })

  // Context menu — handled directly; no IPC round-trip required
  geminiView.webContents.on('context-menu', (_event, params) => {
    const { selectionText, isEditable } = params
    const items: MenuItemConstructorOptions[] = []

    if (selectionText?.length > 0 || !isEditable) {
      items.push({ label: 'Copy', click: () => geminiView.webContents.copy() })
    }
    if (isEditable) {
      if (items.length > 0) items.push({ type: 'separator' })
      items.push({ label: 'Paste', click: () => geminiView.webContents.paste() })
    }
    if (items.length === 0) {
      items.push(
        { label: 'Copy', click: () => geminiView.webContents.copy() },
        { type: 'separator' },
        { label: 'Paste', click: () => geminiView.webContents.paste() }
      )
    }

    Menu.buildFromTemplate(items).popup({ window: win })
  })

  // New-window handler for Gemini: allow Google OAuth popups, open others externally
  geminiView.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('https://accounts.google.com') ||
      url.startsWith('https://gemini.google.com')
    ) {
      return { action: 'allow' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  geminiView.webContents.loadURL(GEMINI_URL)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

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
