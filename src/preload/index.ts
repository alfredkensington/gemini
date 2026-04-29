import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  showContextMenu: (params: { selectionText: string; isEditable: boolean }): void => {
    ipcRenderer.send('show-context-menu', params)
  },
  onContextMenuAction: (callback: (action: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: string): void => callback(action)
    ipcRenderer.on('context-menu-action', listener)
    return () => ipcRenderer.removeListener('context-menu-action', listener)
  }
})
