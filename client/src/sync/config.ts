export type SyncProvider = '' | 'dropbox';

export interface SyncConfig {
  provider: SyncProvider;
  clientId: string;
}

export function readSyncConfig(): SyncConfig | null {
  if (typeof document === 'undefined') return null;
  const get = (name: string) => (
    document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null
  )?.content ?? '';
  const provider = get('bm-sync-provider');
  if (provider !== 'dropbox') return null;
  const config: SyncConfig = {
    provider,
    clientId: get('bm-sync-client-id'),
  };
  return Object.values(config).every(Boolean) ? config : null;
}
