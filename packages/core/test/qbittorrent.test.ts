import { afterEach, describe, expect, test, vi } from "vitest";
import { QbtClient, QbtError, qbtStateToStatus } from "../src/qbittorrent.js";

const CFG = { url: "http://qbt.local:8080", username: "admin", password: "pass" };

function loginOk(sid = "abc123") {
  return new Response("Ok.", {
    status: 200,
    headers: { "set-cookie": `SID=${sid}; HttpOnly; path=/` },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("QbtClient", () => {
  test("логинится и шлёт cookie в запросах", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response("4.6.5", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new QbtClient(CFG);
    expect(await client.version()).toBe("4.6.5");

    const [loginUrl, loginInit] = fetchMock.mock.calls[0];
    expect(String(loginUrl)).toBe("http://qbt.local:8080/api/v2/auth/login");
    expect(String(loginInit.body)).toContain("username=admin");
    const [, verInit] = fetchMock.mock.calls[1];
    expect((verInit.headers as Record<string, string>).Cookie).toBe("SID=abc123");
  });

  test("ответ Fails. на логин → QbtError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Fails.", { status: 200 })));
    const err = await new QbtClient(CFG).version().catch((e) => e);
    expect(err).toBeInstanceOf(QbtError);
    expect((err as QbtError).message).toBe("Неверный логин или пароль qBittorrent");
  });

  test("403 → перелогин и повтор запроса", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk("old"))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(loginOk("fresh"))
      .mockResolvedValueOnce(new Response("4.6.5", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await new QbtClient(CFG).version()).toBe("4.6.5");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, lastInit] = fetchMock.mock.calls[3];
    expect((lastInit.headers as Record<string, string>).Cookie).toBe("SID=fresh");
  });

  test("addTorrent передаёт urls/savepath/category/tags", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response("Ok.", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new QbtClient(CFG).addTorrent({
      url: "magnet:?xt=urn:btih:deadbeef",
      savePath: "/staging",
      category: "dublyarr",
      tags: "dublyarr-1",
    });
    const [addUrl, addInit] = fetchMock.mock.calls[1];
    expect(String(addUrl)).toBe("http://qbt.local:8080/api/v2/torrents/add");
    const body = String(addInit.body);
    expect(body).toContain(encodeURIComponent("magnet:?xt=urn:btih:deadbeef"));
    expect(body).toContain("savepath=%2Fstaging");
    expect(body).toContain("category=dublyarr");
    expect(body).toContain("tags=dublyarr-1");
  });

  test("addTorrent: ответ Fails. → QbtError", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(loginOk())
        .mockResolvedValueOnce(new Response("Fails.", { status: 200 })),
    );
    const err = await new QbtClient(CFG)
      .addTorrent({ url: "magnet:?xt=x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(QbtError);
    expect((err as QbtError).message).toBe("qBittorrent отклонил раздачу");
  });

  test("listTorrents маппит поля и фильтрует по tag", async () => {
    const raw = [
      {
        hash: "deadbeef",
        name: "Rick.and.Morty.S01",
        progress: 0.42,
        state: "downloading",
        save_path: "/staging",
        content_path: "/staging/Rick.and.Morty.S01",
        size: 1000,
        dlspeed: 99,
        tags: "dublyarr-1, other",
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        new Response(JSON.stringify(raw), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await new QbtClient(CFG).listTorrents({ tag: "dublyarr-1" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("tag=dublyarr-1");
    expect(out).toEqual([
      {
        hash: "deadbeef",
        name: "Rick.and.Morty.S01",
        progress: 0.42,
        state: "downloading",
        savePath: "/staging",
        contentPath: "/staging/Rick.and.Morty.S01",
        size: 1000,
        dlspeed: 99,
        tags: ["dublyarr-1", "other"],
      },
    ]);
  });
});

describe("qbtStateToStatus", () => {
  test("error и missingFiles → failed", () => {
    expect(qbtStateToStatus("error", 0.5)).toBe("failed");
    expect(qbtStateToStatus("missingFiles", 1)).toBe("failed");
  });
  test("progress >= 1 → completed", () => {
    expect(qbtStateToStatus("uploading", 1)).toBe("completed");
    expect(qbtStateToStatus("pausedUP", 1)).toBe("completed");
  });
  test("иначе downloading", () => {
    expect(qbtStateToStatus("downloading", 0.5)).toBe("downloading");
    expect(qbtStateToStatus("stalledDL", 0)).toBe("downloading");
  });
});
