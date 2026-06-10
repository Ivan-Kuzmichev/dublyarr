import { describe, expect, test } from "vitest";
import {
  createSession,
  hashPassword,
  isPrivateIp,
  verifyPassword,
  verifySession,
} from "../src/auth.js";

describe("hashPassword/verifyPassword", () => {
  test("верный пароль проходит, неверный — нет", () => {
    const stored = hashPassword("секрет123");
    expect(stored.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("секрет123", stored)).toBe(true);
    expect(verifyPassword("не тот", stored)).toBe(false);
  });

  test("две соли → разные хеши одного пароля, оба валидны", () => {
    const a = hashPassword("p");
    const b = hashPassword("p");
    expect(a).not.toBe(b);
    expect(verifyPassword("p", a)).toBe(true);
    expect(verifyPassword("p", b)).toBe(true);
  });

  test("мусорный stored → false, не бросает", () => {
    expect(verifyPassword("p", "")).toBe(false);
    expect(verifyPassword("p", "bcrypt:x:y")).toBe(false);
    expect(verifyPassword("p", "scrypt:onlysalt")).toBe(false);
  });
});

describe("createSession/verifySession", () => {
  const hash = hashPassword("pw");

  test("свежий токен валиден, чужим ключом — нет", () => {
    const token = createSession(hash);
    expect(verifySession(token, hash)).toBe(true);
    expect(verifySession(token, hashPassword("другой"))).toBe(false);
  });

  test("просроченный токен невалиден", () => {
    const now = 1_700_000_000_000;
    const token = createSession(hash, 1000, now);
    expect(verifySession(token, hash, now + 500)).toBe(true);
    expect(verifySession(token, hash, now + 1500)).toBe(false);
  });

  test("подделка exp ломает подпись", () => {
    const token = createSession(hash);
    const sig = token.slice(token.lastIndexOf(".") + 1);
    const forged = `${Date.now() + 10 ** 10}.${sig}`;
    expect(verifySession(forged, hash)).toBe(false);
    expect(verifySession("", hash)).toBe(false);
    expect(verifySession("abc", hash)).toBe(false);
  });

  test("пустой passwordHash: verifySession→false, createSession бросает", () => {
    expect(verifySession(createSession(hashPassword("x")), "")).toBe(false);
    expect(() => createSession("")).toThrow();
  });
});

describe("isPrivateIp", () => {
  test("приватные диапазоны", () => {
    for (const ip of [
      "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255",
      "192.168.1.10", "169.254.1.1", "::1", "::ffff:192.168.0.2",
      "fd00::1", "fe80::abcd",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  test("публичные и мусор", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "193.168.1.1", "2a00:1450::1", "", "not-an-ip", "10.999.0.1", "::ffff:8.8.8.8", "256.1.1.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});
