import {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  shell,
  Menu,
  nativeImage,
  type MenuItemConstructorOptions,
  type WebContents
} from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, writeFileSync, createWriteStream, type WriteStream } from 'fs'
import { is } from '@electron-toolkit/utils'

const ICON_PATH = join(__dirname, '../../resources/icon.icns')
const GEMINI_URL = 'https://gemini.google.com/app'
// Real macOS version of the host. Sent both as the Sec-CH-UA-Platform-Version
// HTTP header AND as userAgentData.getHighEntropyValues({platformVersion: true}).
// The two MUST match — Google cross-checks them and treats a discrepancy as a
// fingerprint signal. Using the host's real version makes the pair self-consistent
// across every machine the app ships to.
const PLATFORM_VERSION = process.getSystemVersion()
// Microsoft Edge — not Chrome — is the cleanest impersonation target for an Electron wrapper.
// Edge is itself Chromium with rebranding (just like us), so navigator/window APIs already match.
// accounts.google.com applies stricter "is this really Chrome?" fingerprint checks to UAs that
// claim "Google Chrome" — every wrapper that has tried to claim Chrome has eventually been blocked
// (nativefier, gmail-desktop, google-chat-electron, ferdium, etc. all converged on Edge/Firefox).
// Edge is a Microsoft product Google recognises as a first-party trusted browser.
//
// Versions are pinned to current stable Edge on macOS at the time of writing (May 2026):
// Edge 147.0.3912.98, based on Chromium 147. UA reduction applies to the Chrome/X.Y.Z.W token,
// so it is "Chrome/147.0.0.0", but Edge does NOT reduce its own Edg/X.Y.Z.W token.
const EDGE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.3912.98'
// Low-entropy Client Hints sent automatically by real Edge with every HTTPS request.
// Electron's Chromium ships these as "Chromium" + "Not_A Brand" with no Edge brand — Google
// uses the absence of a recognised brand as the primary "embedded webview" tell.
const SEC_CH_UA = '"Microsoft Edge";v="147", "Chromium";v="147", "Not_A Brand";v="24"'
// High-entropy full-version list — accounts.google.com requests this to verify brand consistency.
const SEC_CH_UA_FULL =
  '"Microsoft Edge";v="147.0.3912.98", "Chromium";v="147.0.7274.95", "Not_A Brand";v="24.0.0.0"'

// Injected into every page's main world via CDP Page.addScriptToEvaluateOnNewDocument.
// Runs BEFORE any <head> or inline scripts — must, because Google's detection runs synchronously
// in the first scripts on accounts.google.com.
//
// Why main world: session preloads with contextIsolation:true execute in isolated world 999.
// Object.defineProperty(navigator, ...) in isolated world is invisible to the page's own scripts,
// so the same defines have to live here and run via CDP to land in world 0.
//
// What we patch and why:
//   navigator.webdriver  — Electron with --disable-blink-features=AutomationControlled normally
//                          omits this, but defining it as `false` is what real browsers expose
//                          and is what Google's sign-in JS checks for.
//   navigator.vendor     — Edge inherits "Google Inc." from Chromium; Electron returns "".
//   navigator.userAgentData
//                        — Electron's brands[] omits Edge; must match sec-ch-ua exactly or
//                          Google's brand-consistency check rejects the request.
//   navigator.plugins    — Real Chromium always reports the bundled PDF viewer; an empty
//                          plugins[] is a long-standing automation/embedded-browser tell.
//   window.chrome.csi / loadTimes
//                        — Edge keeps these for compatibility; Electron's Chromium build does
//                          not, and Google's sign-in page reads them as a feature-detection.
const BROWSER_PATCH_SCRIPT = `(function () {
  try { Object.defineProperty(navigator, 'webdriver', { get: function () { return false } }) } catch (_) {}
  try { Object.defineProperty(navigator, 'vendor', { get: function () { return 'Google Inc.' } }) } catch (_) {}
  try {
    const brands = [
      { brand: 'Microsoft Edge', version: '147' },
      { brand: 'Chromium', version: '147' },
      { brand: 'Not_A Brand', version: '24' }
    ]
    const fullVersionList = [
      { brand: 'Microsoft Edge', version: '147.0.3912.98' },
      { brand: 'Chromium', version: '147.0.7274.95' },
      { brand: 'Not_A Brand', version: '24.0.0.0' }
    ]
    Object.defineProperty(navigator, 'userAgentData', {
      get: function () {
        return {
          brands: brands,
          mobile: false,
          platform: 'macOS',
          getHighEntropyValues: function (hints) {
            const result = { brands: brands, mobile: false, platform: 'macOS' }
            if (!hints) return Promise.resolve(result)
            if (hints.indexOf('platformVersion') !== -1) result.platformVersion = '${PLATFORM_VERSION}'
            if (hints.indexOf('architecture') !== -1) result.architecture = 'x86'
            if (hints.indexOf('bitness') !== -1) result.bitness = '64'
            if (hints.indexOf('model') !== -1) result.model = ''
            if (hints.indexOf('uaFullVersion') !== -1) result.uaFullVersion = '147.0.3912.98'
            if (hints.indexOf('fullVersionList') !== -1) result.fullVersionList = fullVersionList
            if (hints.indexOf('wow64') !== -1) result.wow64 = false
            return Promise.resolve(result)
          },
          toJSON: function () { return { brands: brands, mobile: false, platform: 'macOS' } }
        }
      }
    })
  } catch (_) {}
  try {
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', { get: function () { return [1, 2, 3, 4, 5] } })
    }
  } catch (_) {}
  const c = window.chrome
  if (c && c.runtime && typeof c.loadTimes === 'function') return
  const noop = function () {}
  window.chrome = Object.assign(c || {}, {
    app: { isInstalled: false, InstallState: {}, RunningState: {}, getDetails: noop, getIsInstalled: noop, runningState: noop },
    csi: function () { return { startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 } },
    loadTimes: function () { return { requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000, commitLoadTime: Date.now() / 1000, finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' } },
    runtime: Object.assign((c && c.runtime) || {}, { id: undefined })
  })
})()`

// Schedules BROWSER_PATCH_SCRIPT to run at document-creation time — BEFORE any <head>
// or inline scripts execute. executeJavaScript (dom-ready) is too late: Google's
// detection runs in <head> scripts. Page.addScriptToEvaluateOnNewDocument persists
// across navigations; one call per webContents covers all future loads.
//
// Both attach() and sendCommand() can throw SYNCHRONOUSLY in failure modes (debugger
// already attached by something else, contents destroyed, etc.) — not just reject. A
// bare .catch() on the promise would miss those, so the sendCommand call itself is
// wrapped in try/catch in addition to the rejection handler.
//
// Two callers use this function:
//   - The Gemini view via initGeminiView, where the about:blank pre-load guarantees
//     a live renderer before this is invoked, so the registration completes against
//     a real CDP session before the real navigation begins.
//   - OAuth popups via did-create-window, where the popup is born loading its target
//     URL and we cannot interpose. There the pre-loadURL ordering relies on Chromium
//     queueing the addScriptToEvaluateOnNewDocument in the browser process and applying
//     it during renderer init, before document parse — empirically reliable but not
//     formally guaranteed; the dom-ready executeJavaScript fallback in the same handler
//     covers the case where the queued script somehow misses the first parse.
function attachEarlyPatch(wc: WebContents): void {
  try {
    wc.debugger.attach('1.3')
  } catch (err) {
    // Already attached, or contents destroyed. sendCommand below will surface the real
    // failure if the debugger truly isn't usable.
    log('main', 'debug', `CDP attach skipped: ${(err as Error).message}`)
  }
  try {
    wc.debugger
      .sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: BROWSER_PATCH_SCRIPT })
      .then(() => log('main', 'debug', `CDP early-patch registered for wc#${wc.id}`))
      .catch((err) =>
        log('main', 'error', `CDP early-patch rejected: ${(err as Error).message}`)
      )
  } catch (err) {
    log('main', 'error', `CDP early-patch threw synchronously: ${(err as Error).message}`)
  }
}

// Two-step initialisation for the main Gemini view. Closes the ordering gap that
// Copilot's review (PR #1, line 449) flagged: fire-and-forget attachEarlyPatch leaves
// no formal guarantee that Page.addScriptToEvaluateOnNewDocument has been processed
// before loadURL(GEMINI_URL) starts the navigation, even though Chromium's browser-
// process queue makes this work in practice.
//
// Step 1: loadURL('about:blank') — spawns the renderer cheaply, no network. The
//         awaited promise resolves only once the blank document is committed, so by
//         the time we move on, the webContents has a live renderer that CDP can talk to.
// Step 2: await sendCommand on Page.addScriptToEvaluateOnNewDocument. Now safe to
//         await — the renderer exists, the CDP response will come back, no deadlock.
// Step 3: loadURL(GEMINI_URL) starts the real navigation with the patch script
//         registered. The first document Google's detection sees is patched.
async function initGeminiView(view: WebContentsView): Promise<void> {
  const wc = view.webContents
  try {
    await wc.loadURL('about:blank')
  } catch (err) {
    // about:blank should never fail, but if it does we still want the real load to fire
    // so the user sees something (and any console-message from that load goes to the log).
    log('main', 'error', `about:blank pre-load failed: ${(err as Error).message}`)
  }
  try {
    wc.debugger.attach('1.3')
  } catch (err) {
    log('main', 'debug', `CDP attach skipped: ${(err as Error).message}`)
  }
  try {
    await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: BROWSER_PATCH_SCRIPT
    })
    log('main', 'debug', `CDP early-patch registered for wc#${wc.id} (gemini view)`)
  } catch (err) {
    log('main', 'error', `CDP early-patch failed (gemini view): ${(err as Error).message}`)
  }
  try {
    await wc.loadURL(GEMINI_URL)
  } catch (err) {
    log('main', 'error', `Gemini load failed: ${(err as Error).message}`)
  }
}

// Prevent Chromium from advertising automation mode — Google sign-in checks for this flag
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')

function setupGeminiSession(): void {
  const geminiSession = session.fromPartition('persist:gemini')

  // Set UA at session level so HTTP request headers carry the spoofed UA, not just navigator.userAgent
  geminiSession.setUserAgent(EDGE_UA)

  // Rewrite outgoing request headers to match real Microsoft Edge 147 on macOS.
  // session.setUserAgent() patches User-Agent but leaves Sec-CH-UA untouched.
  // Electron's Chromium sends only "Chromium";v="X" — missing the "Microsoft Edge" brand,
  // which is the signal accounts.google.com uses to flag the client as an embedded webview.
  // sec-ch-ua-platform-version is included because accounts.google.com lists it in Accept-CH
  // and a missing high-entropy hint after a server request for it is itself a fingerprint.
  geminiSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers: Record<string, string> = {}
    const toReplace = new Set([
      'user-agent',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'sec-ch-ua-platform-version',
      'sec-ch-ua-full-version',
      'sec-ch-ua-full-version-list',
      'sec-ch-ua-arch',
      'sec-ch-ua-bitness',
      'sec-ch-ua-model',
      'sec-ch-ua-wow64'
    ])
    for (const [k, v] of Object.entries(details.requestHeaders)) {
      if (!toReplace.has(k.toLowerCase())) headers[k] = v
    }
    headers['User-Agent'] = EDGE_UA
    headers['sec-ch-ua'] = SEC_CH_UA
    headers['sec-ch-ua-mobile'] = '?0'
    headers['sec-ch-ua-platform'] = '"macOS"'
    headers['sec-ch-ua-platform-version'] = `"${PLATFORM_VERSION}"`
    headers['sec-ch-ua-full-version'] = '"147.0.3912.98"'
    headers['sec-ch-ua-full-version-list'] = SEC_CH_UA_FULL
    headers['sec-ch-ua-arch'] = '"x86"'
    headers['sec-ch-ua-bitness'] = '"64"'
    headers['sec-ch-ua-model'] = '""'
    headers['sec-ch-ua-wow64'] = '?0'
    callback({ requestHeaders: headers })
  })

  // Preload runs before any page script in ALL pages/popups using this session (including OAuth windows).
  // registerPreloadScript replaced setPreloads in Electron 35 — same effect, no deprecation warning.
  const preloadPath = app.isPackaged
    ? join(process.resourcesPath, 'webview-preload.js')
    : join(__dirname, '../../resources/webview-preload.js')
  geminiSession.registerPreloadScript({
    type: 'frame',
    id: 'gemini-webview-preload',
    filePath: preloadPath
  })

  geminiSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true)
  })
  geminiSession.setPermissionCheckHandler(() => true)

  geminiSession.on('will-download', (_event, item) => {
    item.setSavePath(join(homedir(), 'Downloads', item.getFilename()))
  })
}

// ── /tmp/gemini.log sink ─────────────────────────────────────────────────────
// Append-mode write stream so consecutive launches accumulate in the same file.
// Opened lazily on first use so a missing /tmp doesn't crash the process before
// app.whenReady. Each launch writes a session header so runs are distinguishable.
const LOG_PATH = '/tmp/gemini.log'
let logStream: WriteStream | null = null

function log(label: string, level: string, message: string, where = ''): void {
  if (!logStream) {
    logStream = createWriteStream(LOG_PATH, { flags: 'a' })
    logStream.write(
      `\n=== Gemini session ${new Date().toISOString()} | ` +
        `Electron ${process.versions.electron} | Chromium ${process.versions.chrome} | ` +
        `Node ${process.versions.node} ===\n`
    )
  }
  const ts = new Date().toISOString()
  const lvl = level.toUpperCase().padEnd(5)
  const loc = where ? ` ${where}` : ''
  logStream.write(`[${ts}] ${lvl} [${label}]${loc}  ${message}\n`)
}

// Map Electron's console-message levels (string in 35+, integer in older builds)
// to the four-letter labels DevTools shows in its console UI.
const LEVEL_FROM_INT: Record<number, string> = { 0: 'debug', 1: 'info', 2: 'warn', 3: 'error' }
function normaliseLevel(level: unknown): string {
  if (typeof level === 'number') return LEVEL_FROM_INT[level] ?? `lvl${level}`
  if (typeof level === 'string') {
    if (level === 'warning') return 'warn'
    return level
  }
  return 'info'
}

// Mirror everything that would appear in DevTools Console for `wc` to /tmp/gemini.log.
// Covers: console.{log,info,warn,error,debug}, uncaught JS exceptions (Chromium routes
// these through console-message), CSP/security/deprecation warnings, plus three out-of-band
// channels DevTools also surfaces: preload-script errors, renderer crashes, and load failures.
function setupConsoleLogging(wc: WebContents, label: string): void {
  // Electron 35+ delivers a single Event with .level/.message/.lineNumber/.sourceId/.frame.
  // Older Electron used (event, level, message, line, sourceId). Handle both shapes so a
  // future downgrade doesn't silently drop the log feed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wc.on('console-message', (...args: any[]) => {
    let level: unknown, message = '', line = 0, sourceId = ''
    const first = args[0]
    if (first && typeof first === 'object' && 'level' in first && 'message' in first) {
      level = first.level
      message = String(first.message ?? '')
      line = Number(first.lineNumber ?? 0)
      sourceId = String(first.sourceId ?? '')
    } else {
      level = args[1]
      message = String(args[2] ?? '')
      line = Number(args[3] ?? 0)
      sourceId = String(args[4] ?? '')
    }
    log(label, normaliseLevel(level), message, sourceId ? `${sourceId}:${line}` : '')
  })

  wc.on('preload-error', (_e, preloadPath, error) => {
    log(label, 'error', `preload threw: ${error.message}\n${error.stack ?? ''}`, preloadPath)
  })

  wc.on('render-process-gone', (_e, details) => {
    log(label, 'error', `renderer gone: reason=${details.reason} exitCode=${details.exitCode}`)
  })

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) return // ABORTED — fired on every user-initiated nav cancellation, noise
    log(
      label,
      'error',
      `load failed: ${errorDescription} (code ${errorCode}, mainFrame=${isMainFrame})`,
      validatedURL
    )
  })
}

// One-time wipe of the persist:gemini partition.
// Earlier app versions claimed to be Google Chrome, failed accounts.google.com's
// browser check, and in the process collected cookies (NID, GAPS, …), localStorage,
// IndexedDB, and possibly a service worker that cached the "browser may not be secure"
// page. All of that survives an app upgrade and re-poisons the new build before the
// Edge spoof has a chance to take effect — accounts.google.com sees the bad cookies
// and short-circuits straight back to the rejection page.
//
// Run once per install, gated by a marker file under userData. The marker name carries
// a version so we can re-trigger the wipe in a future fix without touching old marker
// files. The marker is created only after the wipe resolves; a crash mid-wipe re-runs
// it on next launch, which is the safe direction.
const WIPE_MARKER = '.session-wipe-edge-ua-v1'

async function wipeStaleSessionStateOnce(): Promise<void> {
  const markerPath = join(app.getPath('userData'), WIPE_MARKER)
  if (existsSync(markerPath)) return

  const geminiSession = session.fromPartition('persist:gemini')
  await Promise.all([
    geminiSession.clearStorageData(),
    geminiSession.clearCache(),
    geminiSession.clearAuthCache(),
    geminiSession.clearHostResolverCache(),
    geminiSession.clearCodeCaches({ urls: [] })
  ])

  writeFileSync(markerPath, new Date().toISOString())
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

  setupConsoleLogging(win.webContents, 'shell')

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

  setupConsoleLogging(geminiView.webContents, 'gemini')

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

  // Fallback: executeJavaScript at dom-ready catches any edge case where the CDP-registered
  // script somehow doesn't fire on a navigation — e.g. an internal subframe or a redirect
  // chain that races script application. Doesn't help with Google's <head>-time detection
  // (which is exactly why we use CDP for the primary injection), but defends the steady state.
  geminiView.webContents.on('dom-ready', () => {
    geminiView.webContents.executeJavaScript(BROWSER_PATCH_SCRIPT).catch(() => {})
  })

  // For OAuth child windows: attach both CDP and dom-ready to the new webContents.
  // The popup uses persist:gemini (via overrideBrowserWindowOptions) so session-level
  // headers and preloads apply, but the webContents-level CDP must be wired separately.
  geminiView.webContents.on('did-create-window', (childWindow) => {
    setupConsoleLogging(childWindow.webContents, 'oauth')
    attachEarlyPatch(childWindow.webContents)
    childWindow.webContents.on('dom-ready', () => {
      childWindow.webContents.executeJavaScript(BROWSER_PATCH_SCRIPT).catch(() => {})
    })
  })

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

  // New-window handler for Gemini: allow Google OAuth popups, open others externally.
  // IMPORTANT: `partition` is NOT in Electron's inherited webPreferences list, so without
  // overrideBrowserWindowOptions the OAuth popup would use session.defaultSession — bypassing
  // the sec-ch-ua header rewrite and the file-input preload entirely.
  geminiView.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('https://accounts.google.com') ||
      url.startsWith('https://gemini.google.com')
    ) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            partition: 'persist:gemini',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
          }
        }
      }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load the shell first so the React loading screen paints while the Gemini view
  // is still doing its two-step CDP/about:blank/loadURL dance below.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Two-step nav for the Gemini view (about:blank → CDP register → real URL).
  // Fired without await so createWindow stays sync — the function manages its own
  // error logging via /tmp/gemini.log.
  void initGeminiView(geminiView)
}

app.whenReady().then(async () => {
  log('main', 'info', `app ready, loading ${GEMINI_URL}`)
  setupGeminiSession()
  // Wipe any stale Chrome-impersonation cookies/cache BEFORE the first navigation,
  // otherwise the rejection-page service worker can answer the load from cache.
  await wipeStaleSessionStateOnce()
  createAppMenu()
  createWindow()
  log('main', 'info', 'window created, navigation initiated')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('quit', () => {
  if (logStream) logStream.end()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
