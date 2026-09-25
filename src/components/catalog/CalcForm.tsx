import { COVERINGS, ROOMS, type CalcInput } from "@/lib/heatingCalc";

/** GET-форма калькулятора: працює без JS, результати рендерить сервер на /calc. */
export function CalcForm({ value, compact = false }: { value?: CalcInput | null; compact?: boolean }) {
  const inputCls =
    "w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]";
  const labelCls = "block text-xs font-semibold uppercase tracking-wide text-[var(--muted-2)]";
  return (
    <form action="/calc" method="get" className={compact ? "grid gap-3 sm:grid-cols-[1fr_1.4fr_1.4fr_auto] sm:items-end" : "grid gap-4 md:grid-cols-[1fr_1.4fr_1.4fr_auto] md:items-end"}>
      <label className={labelCls}>
        Вільна площа, м²
        <input
          name="area"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0.3"
          max="200"
          required
          defaultValue={value?.area ?? ""}
          placeholder="напр. 4,5"
          className={`${inputCls} mt-1.5`}
        />
      </label>
      <label className={labelCls}>
        Покриття
        <select name="covering" defaultValue={value?.covering ?? "tile"} className={`${inputCls} mt-1.5`}>
          {COVERINGS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        Приміщення
        <select name="room" defaultValue={value?.room ?? "living"} className={`${inputCls} mt-1.5`}>
          {ROOMS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn-primary whitespace-nowrap">
        Підібрати
      </button>
    </form>
  );
}
