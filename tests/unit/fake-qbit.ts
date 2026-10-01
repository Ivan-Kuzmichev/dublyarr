import { parseTorrent } from '@/lib/torrent-file';
import type { Qbit, QbitTorrent, QbitFile } from '@/lib/qbit';

export type FakeTorrent = QbitTorrent & { files: QbitFile[]; paused: boolean };

/** qBittorrent в памяти: хранит торренты, приоритеты, состояние. */
export function fakeQbit() {
  const torrents = new Map<string, FakeTorrent>();
  const calls: string[] = [];
  const qbit: Qbit = {
    version: async () => 'v5.1.2',
    async add(t, o) {
      calls.push('add');
      const meta = Buffer.isBuffer(t) ? parseTorrent(t) : { infohash: /btih:([0-9a-f]{40})/i.exec(t.magnet)![1].toLowerCase(), name: 'magnet', files: [] };
      torrents.set(meta.infohash, {
        hash: meta.infohash, name: meta.name, state: o.paused || o.stopOnMetadata ? 'stoppedDL' : 'downloading', progress: 0, dlspeed: 0, eta: 0,
        size: meta.files.reduce((n, f) => n + f.size, 0), num_seeds: 5, save_path: o.savePath, content_path: `${o.savePath}/${meta.name}`, category: o.category,
        // как настоящий qBittorrent: у многофайловой раздачи имена с корневой папкой
        files: meta.files.map((f) => ({ index: f.index, name: meta.files.length > 1 || f.path !== meta.name ? `${meta.name}/${f.path}` : f.path, size: f.size, progress: 0, priority: 1 })),
        paused: o.paused || !!o.stopOnMetadata,
      });
    },
    list: async (category) => [...torrents.values()].filter((t) => t.category === category),
    files: async (hash) => torrents.get(hash)?.files ?? [],
    async setFilePriority(hash, idx, prio) {
      calls.push(`prio:${idx.join(',')}=${prio}`);
      for (const f of torrents.get(hash)?.files ?? []) if (idx.includes(f.index)) f.priority = prio;
    },
    async start(h) {
      calls.push('start');
      for (const x of h) {
        const t = torrents.get(x);
        if (t) Object.assign(t, { paused: false, state: 'downloading' });
      }
    },
    async stop(h) {
      calls.push('stop');
      for (const x of h) {
        const t = torrents.get(x);
        if (t) Object.assign(t, { paused: true, state: 'stoppedDL' });
      }
    },
    async remove(h) {
      calls.push('remove');
      for (const x of h) torrents.delete(x);
    },
    async setDownloadLimit(h, limit) {
      calls.push(`limit:${limit}`);
      for (const x of h) {
        const t = torrents.get(x);
        if (t) t.dl_limit = limit;
      }
    },
    ensureCategory: async () => {
      calls.push('category');
    },
  };
  return { qbit, torrents, calls };
}
