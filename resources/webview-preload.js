// Runs before any page script in every page loaded by the persist:gemini session,
// including Google OAuth popup windows.

// 1. Remove automation signals that cause Google to reject sign-in
Object.defineProperty(navigator, 'webdriver', { get: () => false })

;(function () {
  const automationKeys = Object.keys(window).filter(
    (k) => k.startsWith('cdc_') || k.startsWith('$chrome_')
  )
  automationKeys.forEach((k) => {
    try {
      delete window[k]
    } catch (_) {}
  })
})()

// 2. Patch file inputs: strip accept restrictions, enable multiple selection.
//    Runs after DOM is available so the MutationObserver can attach to document.body.
function patchFileInputs() {
  document.querySelectorAll('input[type="file"]').forEach(function (el) {
    if (!el.hasAttribute('data-gemini-patched')) {
      el.removeAttribute('accept')
      el.setAttribute('multiple', '')
      el.setAttribute('data-gemini-patched', '1')
    }
  })
}

window.addEventListener('DOMContentLoaded', function () {
  patchFileInputs()
  const observer = new MutationObserver(patchFileInputs)
  observer.observe(document.body, { childList: true, subtree: true })
})
