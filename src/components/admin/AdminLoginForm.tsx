"use client";

import { useState } from "react";

export function AdminLoginForm({ routeSecret }: { routeSecret: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="mx-auto max-w-sm space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        setLoading(true);
        const fd = new FormData(e.currentTarget);
        const password = String(fd.get("password") ?? "");
        try {
          const res = await fetch("/api/admin/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password, routeSecret }),
          });
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) {
            setErr(j.error ?? "Помилка входу");
            setLoading(false);
            return;
          }
          window.location.href = `/ops/${routeSecret}/products`;
        } catch {
          setErr("Мережа недоступна");
          setLoading(false);
        }
      }}
    >
      <label className="block text-sm text-zinc-400">
        Пароль
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
        />
      </label>
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {loading ? "…" : "Увійти"}
      </button>
    </form>
  );
}
