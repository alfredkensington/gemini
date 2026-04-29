/// <reference types="vite/client" />

// Extend JSX to recognise the Electron <webview> intrinsic element
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      partition?: string
      allowpopups?: string
      useragent?: string
      webpreferences?: string
      preload?: string
      ref?: React.Ref<Electron.WebviewTag>
      className?: string
    }
  }
}

// Type the contextBridge API exposed from the preload script
interface Window {
  electronAPI: {
    showContextMenu(params: { selectionText: string; isEditable: boolean }): void
    onContextMenuAction(callback: (action: string) => void): () => void
  }
}
