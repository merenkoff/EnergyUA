"use client";

export function AdminLogoutButton({ routeSecret }: { routeSecret: string }) {
  return (
    <button
      type="button"
      className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
      onClick={async () => {
        await fetch("/api/admin/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routeSecret }),
        });
        window.location.href = `/ops/${routeSecret}/login`;
      }}
    >
      Вийти
    </button>
  );
}
