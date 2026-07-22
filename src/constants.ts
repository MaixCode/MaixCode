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

  // Example Commands
  export const openExample = "maixcode.openExample";
}

export const defaultDeviceName = "Unknown";
