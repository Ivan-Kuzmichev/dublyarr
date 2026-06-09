import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseTorznabResponse } from "../src/jackett.js";

const xml = readFileSync(
  new URL("./fixtures/jackett-rick-and-morty.xml", import.meta.url),
  "utf8",
);

describe("parseTorznabResponse", () => {
  test("разбирает все item", () => {
    expect(parseTorznabResponse(xml)).toHaveLength(50);
  });

  test("indexer — строка, не объект (#text из атрибутного элемента)", () => {
    const [first] = parseTorznabResponse(xml);
    expect(first.indexer).toBe("RuTracker.org");
  });

  test("числовые поля из torznab:attr", () => {
    const items = parseTorznabResponse(xml);
    const withSeeders = items.filter((i) => i.seeders > 0);
    expect(withSeeders.length).toBeGreaterThan(0);
    expect(typeof items[0].size).toBe("number");
    expect(items[0].title.length).toBeGreaterThan(0);
    expect(items[0].description.length).toBeGreaterThan(0);
  });

  test("ошибка Jackett из XML пробрасывается", () => {
    const errXml = `<?xml version="1.0"?><error code="100" description="Invalid API Key" />`;
    expect(() => parseTorznabResponse(errXml)).toThrow(/Invalid API Key/);
  });
});
