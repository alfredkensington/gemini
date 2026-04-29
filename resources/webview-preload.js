// Runs inside every page loaded in the persist:gemini webview,
// before any page scripts, stripping the automation signals that
// cause Google to reject sign-in.
Object.defineProperty(navigator, 'webdriver', { get: () => false })

// Remove Chrome DevTools Protocol / automation artefacts left by Chromium
const keysToDelete = Object.keys(window).filter(
  (k) => k.startsWith('cdc_') || k.startsWith('$chrome_')
)
keysToDelete.forEach((k) => {
  try { delete window[k] } catch (_) {}
})
