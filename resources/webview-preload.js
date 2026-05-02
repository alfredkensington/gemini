// Runs before any page script in every page loaded by the persist:gemini session,
// including Google OAuth popup windows.
//
// NOTE: this preload runs in an ISOLATED world (contextIsolation: true). Anything that
// must be visible to the page's own scripts (navigator.* defines, window.chrome, etc.)
// is injected from the main process via CDP Page.addScriptToEvaluateOnNewDocument and
// lives in BROWSER_PATCH_SCRIPT in src/main/index.ts. Only DOM-level work belongs here.

// Patch file inputs: strip accept restrictions, enable multiple selection.
// Runs after DOM is available so the MutationObserver can attach to document.body.
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
