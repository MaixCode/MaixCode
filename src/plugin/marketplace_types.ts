export type PluginMarketplaceSourceType = "github" | "http";

export interface PluginMarketplaceConfig {
  id: string;
  label: string;
  type: PluginMarketplaceSourceType;
  owner?: string;
  repo?: string;
  path?: string;
  ref?: string;
  url?: string;
}

export type PluginSource =
  | { type: "path"; path: string }
  | { type: "github-repo"; owner: string; repo: string; ref?: string; path?: string }
  | { type: "github-release"; owner: string; repo: string; release: { tag?: string; asset: string } }
  | { type: "http"; url: string };

export interface MarketplaceAuthor {
  name: string;
  url?: string;
}

export interface MarketplacePluginEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: MarketplaceAuthor;
  icon?: string;
  apiVersion: string;
  permissions: string[];
  contributes?: {
    commands?: Array<{ id: string; title: string }>;
    views?: Array<{ id: string; name: string }>;
  };
  source: PluginSource;
  updatedAt?: string;
}

export interface MarketplaceIndex {
  version: number;
  updatedAt?: string;
  plugins: MarketplacePluginEntry[];
}

export type MarketplaceInstallResult =
  | { ok: true; id: string }
  | { ok: false; id: string; error: string };
