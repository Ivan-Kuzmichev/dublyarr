export interface QbtConfig {
  url: string;
  username: string;
  password: string;
}

export class QbtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QbtError";
  }
}

export interface QbtTorrent {
  hash: string;
  name: string;
  progress: number;
  state: string;
  savePath: string;
  contentPath: string;
  size: number;
  dlspeed: number;
  tags: string[];
}

export interface QbtFile {
  name: string;
  size: number;
  progress: number;
}

/** Маппинг состояния qBittorrent в статус загрузки Dublyarr. */
export function qbtStateToStatus(
  state: string,
  progress: number,
): "downloading" | "completed" | "failed" {
  if (state === "error" || state === "missingFiles") return "failed";
  if (progress >= 1) return "completed";
  return "downloading";
}

export class QbtClient {
  private cookie: string | null = null;

  constructor(private cfg: QbtConfig) {}

  private async login(): Promise<void> {
    const res = await fetch(new URL("/api/v2/auth/login", this.cfg.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: this.cfg.url,
      },
      body: new URLSearchParams({
        username: this.cfg.username,
        password: this.cfg.password,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new QbtError(`qBittorrent: ${res.status} ${res.statusText}`);
    }
    if (text.trim() !== "Ok.") {
      throw new QbtError("Неверный логин или пароль qBittorrent");
    }
    const m = (res.headers.get("set-cookie") ?? "").match(/SID=[^;]+/);
    if (!m) throw new QbtError("qBittorrent не вернул cookie сессии");
    this.cookie = m[0];
  }

  private async request(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<Response> {
    if (!this.cookie) await this.login();
    const res = await fetch(new URL(path, this.cfg.url), {
      ...init,
      headers: {
        ...((init.headers as Record<string, string>) ?? {}),
        Cookie: this.cookie!,
        Referer: this.cfg.url,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 403 && retry) {
      this.cookie = null;
      return this.request(path, init, false);
    }
    if (!res.ok) throw new QbtError(`qBittorrent ${res.status} ${res.statusText}`);
    return res;
  }

  async version(): Promise<string> {
    return (await this.request("/api/v2/app/version")).text();
  }

  async addTorrent(opts: {
    url: string;
    savePath?: string;
    category?: string;
    tags?: string;
  }): Promise<void> {
    const body = new URLSearchParams({ urls: opts.url });
    if (opts.savePath) body.set("savepath", opts.savePath);
    if (opts.category) body.set("category", opts.category);
    if (opts.tags) body.set("tags", opts.tags);
    const res = await this.request("/api/v2/torrents/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await res.text();
    if (text.trim() === "Fails.") throw new QbtError("qBittorrent отклонил раздачу");
  }

  async listTorrents(
    filter: { tag?: string; hashes?: string[] } = {},
  ): Promise<QbtTorrent[]> {
    const params = new URLSearchParams();
    if (filter.tag) params.set("tag", filter.tag);
    if (filter.hashes?.length) params.set("hashes", filter.hashes.join("|"));
    const qs = params.toString();
    const res = await this.request(`/api/v2/torrents/info${qs ? `?${qs}` : ""}`);
    const raw = (await res.json()) as Record<string, unknown>[];
    return raw.map((t) => ({
      hash: String(t.hash ?? ""),
      name: String(t.name ?? ""),
      progress: Number(t.progress ?? 0),
      state: String(t.state ?? ""),
      savePath: String(t.save_path ?? ""),
      contentPath: String(t.content_path ?? ""),
      size: Number(t.size ?? 0),
      dlspeed: Number(t.dlspeed ?? 0),
      tags: String(t.tags ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }));
  }

  async listFiles(hash: string): Promise<QbtFile[]> {
    const res = await this.request(
      `/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`,
    );
    const raw = (await res.json()) as Record<string, unknown>[];
    return raw.map((f) => ({
      name: String(f.name ?? ""),
      size: Number(f.size ?? 0),
      progress: Number(f.progress ?? 0),
    }));
  }

  async deleteTorrent(hash: string, deleteFiles: boolean): Promise<void> {
    await this.request("/api/v2/torrents/delete", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        hashes: hash,
        deleteFiles: String(deleteFiles),
      }).toString(),
    });
  }
}
