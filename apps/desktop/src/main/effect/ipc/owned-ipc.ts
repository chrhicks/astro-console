import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

export function ownedIpcHandle(allowed: WebContents) {
  return (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender.id !== allowed.id || allowed.isDestroyed()) {
        throw new Error('Unauthorized IPC sender')
      }
      return listener(event, ...args)
    })
  }
}
