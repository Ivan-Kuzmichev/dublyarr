import { XMLParser } from "fast-xml-parser";
import type { ReleaseInput } from "./parser.js";

export interface JackettRelease extends ReleaseInput {
  trackerType: string;
  guid: string;
  comments: string;
  pubDate: string;
  size: number;
  seeders: number;
  peers: number;
  grabs: number;
  link: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "item" || name === "category",
});

function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") return String((v as Record<string, unknown>)["#text"] ?? "");
  return String(v);
}

function attrMap(item: Record<string, unknown>): Record<string, unknown> {
  const ns = "torznab:attr";
  const raw = item[ns];
  if (!raw) return {};
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: Record<string, unknown> = {};
  for (const a of arr as Record<string, unknown>[]) {
    const k = a["@_name"] as string | undefined;
    const v = a["@_value"];
    if (k == null) continue;
    if (out[k] !== undefined) {
      if (Array.isArray(out[k])) (out[k] as unknown[]).push(v);
      else out[k] = [out[k], v];
    } else {
      out[k] = v;
    }
  }
  return out;
}

function normalizeItem(it: Record<string, unknown>): JackettRelease {
  const attrs = attrMap(it);
  const seeders = parseInt(String(attrs.seeders ?? "0"), 10) || 0;
  const peers = parseInt(String(attrs.peers ?? "0"), 10) || 0;
  const size = parseInt(String(it.size ?? "0"), 10) || 0;
  return {
    title: asText(it.title),
    description: asText(it.description),
    indexer: asText(it.jackettindexer),
    trackerType: asText(it.type),
    guid: asText(it.guid),
    comments: asText(it.comments),
    pubDate: asText(it.pubDate),
    size,
    seeders,
    peers,
    grabs: parseInt(asText(it.grabs) || "0", 10) || 0,
    link: asText(it.link),
  };
}

export function parseTorznabResponse(xml: string): JackettRelease[] {
  const errMatch = xml.match(/<error[^>]*description="([^"]+)"/);
  if (errMatch) throw new Error(`Jackett: ${errMatch[1]}`);
  const parsed = parser.parse(xml);
  const items: Record<string, unknown>[] = parsed?.rss?.channel?.item ?? [];
  return items.map(normalizeItem);
}

export interface JackettConfig {
  url: string;
  apiKey: string;
}

export async function searchJackett(
  { url, apiKey }: JackettConfig,
  query: string,
): Promise<JackettRelease[]> {
  const u = new URL("/api/v2.0/indexers/all/results/torznab/api", url);
  u.searchParams.set("apikey", apiKey);
  u.searchParams.set("t", "search");
  u.searchParams.set("q", query);
  const res = await fetch(u, {
    headers: { Accept: "application/xml" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Jackett ${res.status} ${res.statusText}`);
  return parseTorznabResponse(await res.text());
}
