export const DebugTypeName = "maixpy";

export namespace Commands {
  // Device Commands
  export const connectDevice = "maixcode.connectDevice";
  export const disconnectDevice = "maixcode.disconnectDevice";
  export const discoverDevice = "maixcode.discoverDevice";
  export const refreshDeviceData = "maixcode.refreshDeviceData";

  /** Open interactive SSH terminal to device (ssh2 + Pseudoterminal) */
  export const openDeviceTerminal = "maixcode.openDeviceTerminal";

  /** Open device SFTP as virtual FS workspace folder */
  export const openDeviceSftp = "maixcode.openDeviceSftp";

  /** SFTP Explorer: add path to hide patterns */
  export const sftpFilterPath = "maixcode.sftpFilterPath";
  /** SFTP Explorer: remove matching hide pattern */
  export const sftpUnfilterPath = "maixcode.sftpUnfilterPath";
  /** Toggle showing filtered entries with badges */
  export const sftpToggleShowFiltered = "maixcode.sftpToggleShowFiltered";
  export const sftpEditFilterPatterns = "maixcode.sftpEditFilterPatterns";
  /** Re-list SFTP directory / refresh Explorer tree */
  export const sftpRefresh = "maixcode.sftpRefresh";

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
  export const imageServicePort = "imageServicePort";
  export const imageViewerDefaultMode = "imageViewerDefaultMode";
  export const imageHttpIntervalMs = "imageHttpIntervalMs";
  export const imageViewerAutoStart = "imageViewerAutoStart";
  export const sshPort = "sshPort";
  export const sshConnectTimeoutMs = "sshConnectTimeoutMs";
  export const sshCredentials = "sshCredentials";
  /** Remote directory mounted as workspace root */
  export const sftpRoot = "sftpRoot";
  /** Glob or /regex/ patterns to hide from SFTP Explorer listings */
  export const sftpHidePatterns = "sftpHidePatterns";
  export const sftpReadOnly = "sftpReadOnly";
  /** When true, filtered items still appear in Explorer (with decoration). */
  export const sftpShowFiltered = "sftpShowFiltered";
  /** Auto-mount SFTP workspace folder when a device connects */
  export const autoOpenSftp = "autoOpenSftp";
}

/** globalState key: last successfully connected device { name, ip } */
export const LastConnectedDeviceKey = "maixcode.lastConnectedDevice";
