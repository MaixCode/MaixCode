export const DebugTypeName = "maixpy";

export namespace Commands {
  // Device Commands
  export const connectDevice = "maixcode.connectDevice";
  export const disconnectDevice = "maixcode.disconnectDevice";
  export const discoverDevice = "maixcode.discoverDevice";
  export const refreshDeviceData = "maixcode.refreshDeviceData";

  // Image Viewer Commands
  export const openImageViewer = "maixcode.openImageViewer";

  // Run on device (starts maixpy debug session for current file)
  export const runOnDevice = "maixcode.runOnDevice";

  // Sidebar Commands
  export const refreshExample = "maixcode.refreshExample";
  export const refreshExampleSource = "maixcode.refreshExampleSource";

  // Example Commands
  export const openExample = "maixcode.openExample";
  /** Open cached/on-disk example file (may be overwritten by Refresh) */
  export const openExampleSource = "maixcode.openExampleSource";
}

export const defaultDeviceName = "Unknown";

/** VS Code configuration section for this extension */
export const ConfigSection = "maixcode";

export namespace ConfigKeys {
  export const enableDeviceDiscovery = "enableDeviceDiscovery";
  export const autoConnect = "autoConnect";
  export const autoConnectTarget = "autoConnectTarget";
}

/** globalState key: last successfully connected device { name, ip } */
export const LastConnectedDeviceKey = "maixcode.lastConnectedDevice";
