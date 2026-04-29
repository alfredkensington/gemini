/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    onLoadingChanged(callback: (loading: boolean) => void): () => void
  }
}
