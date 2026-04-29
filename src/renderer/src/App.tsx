import { useEffect, useRef, useState } from 'react'
import iconPng from './icon.png'

// macOS Chrome UA so Gemini serves its full desktop experience
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const GEMINI_URL = 'https://gemini.google.com/app'

// Script injected on every page load:
// - Overrides document.execCommand('copy') path for legacy copy buttons
// - Grants clipboard-write permission so navigator.clipboard.writeText works
// - Ensures file input elements accept all types and multiple files
const INJECT_SCRIPT = `
(function () {
  // Patch legacy clipboard for any copy buttons that use execCommand
  const _exec = document.execCommand.bind(document)
  document.execCommand = function(cmd, ...args) {
    return _exec(cmd, ...args)
  }

  // Ensure every file input allows all types and multiple selection
  function patchFileInputs() {
    document.querySelectorAll('input[type="file"]').forEach(function(el) {
      if (!el.hasAttribute('data-gemini-patched')) {
        el.removeAttribute('accept')
        el.setAttribute('multiple', '')
        el.setAttribute('data-gemini-patched', '1')
      }
    })
  }

  patchFileInputs()

  const observer = new MutationObserver(patchFileInputs)
  observer.observe(document.body, { childList: true, subtree: true })
})()
`

export default function App(): JSX.Element {
  const webviewRef = useRef<Electron.WebviewTag>(null)
  // loading=true until the first page finishes loading
  const [loading, setLoading] = useState(true)
  // ready=true after the very first successful load (fade-in trigger)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const onStartLoading = (): void => setLoading(true)

    const onStopLoading = (): void => {
      setLoading(false)
      setReady(true)
    }

    const onDomReady = (): void => {
      wv.executeJavaScript(INJECT_SCRIPT).catch(() => {})
    }

    const onContextMenu = (e: Event): void => {
      const ev = e as CustomEvent & { params?: { selectionText?: string; isEditable?: boolean } }
      window.electronAPI.showContextMenu({
        selectionText: ev.params?.selectionText ?? '',
        isEditable: ev.params?.isEditable ?? false
      })
    }

    wv.addEventListener('did-start-loading', onStartLoading)
    wv.addEventListener('did-stop-loading', onStopLoading)
    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('context-menu', onContextMenu)

    return () => {
      wv.removeEventListener('did-start-loading', onStartLoading)
      wv.removeEventListener('did-stop-loading', onStopLoading)
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('context-menu', onContextMenu)
    }
  }, [])

  // Wire context-menu actions (Copy/Paste) chosen from the native menu
  useEffect(() => {
    return window.electronAPI.onContextMenuAction((action) => {
      const wv = webviewRef.current
      if (!wv) return
      if (action === 'copy') wv.copy()
      if (action === 'paste') wv.paste()
    })
  }, [])

  return (
    <div className="root">
      {/* Loading overlay — visible until the first page finishes */}
      <div className={`loader ${loading ? 'loader--visible' : 'loader--hidden'}`}>
        <img src={iconPng} className="loader__icon" alt="" />
      </div>

      {/* The Gemini webview — fades in once ready */}
      <webview
        ref={webviewRef}
        src={GEMINI_URL}
        // persist:gemini → Chromium writes a disk cache shared across launches
        partition="persist:gemini"
        useragent={USER_AGENT}
        // allowpopups is needed for Google OAuth popup flows
        allowpopups="true"
        className={`webview ${ready ? 'webview--visible' : 'webview--hidden'}`}
      />
    </div>
  )
}
