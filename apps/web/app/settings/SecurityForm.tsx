"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./settings.module.css";

export function SecurityForm({
  initialHasPassword,
  initialLanBypass,
}: {
  initialHasPassword: boolean;
  initialLanBypass: boolean;
}) {
  const router = useRouter();
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [lanBypass, setLanBypass] = useState(initialLanBypass);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function savePassword() {
    setStatus(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; hasPassword?: boolean };
      if (!res.ok) {
        setStatus(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      setHasPassword(Boolean(data.hasPassword));
      setCurrent("");
      setNext("");
      setStatus("Сохранено");
    } catch {
      setStatus("Сеть недоступна");
    }
  }

  async function saveLanBypass(value: boolean) {
    setLanBypass(value);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_lan_bypass: value ? "1" : "0" }),
      });
      if (!res.ok) {
        setLanBypass(!value);
        setStatus("Ошибка сохранения");
      }
    } catch {
      setLanBypass(!value);
      setStatus("Сеть недоступна");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  return (
    <div className={styles.card} data-testid="security-form">
      <p className={styles.muted}>
        {hasPassword
          ? "Пароль установлен — страницы и API защищены."
          : "Пароль не установлен — доступ открыт всем."}
      </p>

      {hasPassword && (
        <label className={styles.field}>
          <span>Текущий пароль</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
      )}
      <label className={styles.field}>
        <span>{hasPassword ? "Новый пароль (пусто — снять пароль)" : "Новый пароль"}</span>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <div className={styles.actions}>
        <button onClick={savePassword}>Сохранить пароль</button>
        {hasPassword && <button onClick={logout}>Выйти</button>}
      </div>

      <label className={styles.inline}>
        <input
          type="checkbox"
          checked={lanBypass}
          onChange={(e) => saveLanBypass(e.target.checked)}
        />
        <span>Пускать из локальной сети без пароля</span>
      </label>
      <p className={styles.muted}>
        Определение локальной сети использует X-Forwarded-For: за reverse-proxy
        настройте корректную передачу заголовка, иначе отключите эту опцию.
      </p>

      {status && <p className={status === "Сохранено" ? styles.ok : styles.err}>{status}</p>}
    </div>
  );
}
