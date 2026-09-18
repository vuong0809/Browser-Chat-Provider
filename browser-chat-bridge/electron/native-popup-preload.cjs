"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("browserChatNative", {
  getStatus: () => ipcRenderer.invoke("native-bridge:get-status"),
  registerAgent: agentId => ipcRenderer.invoke("native-bridge:register-agent", { agentId }),
  unregisterAgent: agentId => ipcRenderer.invoke("native-bridge:unregister-agent", { agentId }),
  onStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("native-bridge:status", listener);
    return () => ipcRenderer.removeListener("native-bridge:status", listener);
  }
});
