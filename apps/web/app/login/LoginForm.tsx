"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={submit} data-testid="login-form">
        <h1 className={styles.h1}>⛵ Dublyarr</h1>
        <label className={styles.field}>
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" className={styles.primary} disabled={busy || !password}>
          {busy ? "Вхожу…" : "Войти"}
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </form>
    </div>
  );
}
