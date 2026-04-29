import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onLoadingChanged: (callback: (loading: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, loading: boolean): void =>
      callback(loading)
    ipcRenderer.on('loading-changed', listener)
    return () => ipcRenderer.removeListener('loading-changed', listener)
  }
})
