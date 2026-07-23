export type SshCredential = {
  username: string;
  password?: string;
  label?: string;
};

export type OpenSshTerminalRequest = {
  host: string;
  deviceName?: string;
  port?: number;
};
