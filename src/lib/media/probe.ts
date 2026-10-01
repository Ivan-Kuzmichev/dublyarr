// Разбор вывода ffprobe (-print_format json -show_streams -show_format).

export type Stream = {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'other';
  codec: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  forced: boolean;
  channels?: number;
  width?: number;
  height?: number;
  hdr?: boolean;
  dv?: boolean;
};
export type Probe = { streams: Stream[]; duration: number | null; container: string };
export type TrackInfo = { kind: string; name: string; flag?: string };

type Raw = {
  streams?: {
    index: number;
    codec_name?: string;
    codec_type?: string;
    channels?: number;
    width?: number;
    height?: number;
    color_transfer?: string;
    side_data_list?: { side_data_type?: string }[];
    disposition?: { default?: number; forced?: number };
    tags?: Record<string, string>;
  }[];
  format?: { format_name?: string; duration?: string };
};

const TYPES: Record<string, Stream['type']> = { video: 'video', audio: 'audio', subtitle: 'subtitle' };
const HDR_TRANSFER = new Set(['smpte2084', 'arib-std-b67']);

export function parseProbe(json: unknown): Probe {
  const raw = (json ?? {}) as Raw;
  const streams = (raw.streams ?? []).map((s): Stream => {
    const tags = Object.fromEntries(Object.entries(s.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const lang = tags.language && tags.language !== 'und' ? tags.language.toLowerCase() : null;
    const type = TYPES[s.codec_type ?? ''] ?? 'other';
    const dv = (s.side_data_list ?? []).some((d) => /DOVI/i.test(d.side_data_type ?? ''));
    return {
      index: s.index,
      type,
      codec: s.codec_name ?? '',
      language: type === 'other' ? null : lang,
      title: type === 'other' ? null : (tags.title ?? (type === 'audio' || type === 'subtitle' ? (tags.handler_name ?? null) : null)),
      isDefault: s.disposition?.default === 1,
      forced: s.disposition?.forced === 1,
      ...(s.channels ? { channels: s.channels } : {}),
      ...(type === 'video' ? { width: s.width, height: s.height, hdr: HDR_TRANSFER.has(s.color_transfer ?? '') || dv, dv } : {}),
    };
  });
  const fmt = raw.format?.format_name ?? '';
  const duration = raw.format?.duration ? Number(raw.format.duration) : NaN;
  return { streams, duration: Number.isFinite(duration) ? duration : null, container: /matroska/.test(fmt) ? 'matroska' : /mp4|mov/.test(fmt) ? 'mp4' : fmt.split(',')[0] };
}

/** Класс разрешения по кадру (широкий кадр 3840×1608 — всё равно 2160p). */
export function resolutionOf(p: Probe): number | null {
  const v = p.streams.find((s) => s.type === 'video');
  if (!v?.width || !v.height) return null;
  const { width: w, height: h } = v;
  if (h >= 2000 || w >= 3800) return 2160;
  if (h >= 1000 || w >= 1900) return 1080;
  if (h >= 700 || w >= 1270) return 720;
  if (h >= 560) return 576;
  return 480;
}

export const hdrOf = (p: Probe) => p.streams.some((s) => s.type === 'video' && s.hdr);
