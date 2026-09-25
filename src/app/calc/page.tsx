import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { CalcForm } from "@/components/catalog/CalcForm";
import { ProductCard } from "@/components/catalog/ProductCard";
import { COVERINGS, ROOMS, calculate, parseCalcInput, type CalcResult } from "@/lib/heatingCalc";
import { formatSpecNumber } from "@/lib/productCard";

export const metadata: Metadata = {
  title: "Підбір теплої підлоги за площею",
  description: "Калькулятор: вкажіть вільну площу, покриття і тип приміщення — підберемо нагрівальний мат або кабель і терморегулятор.",
};

type Props = { searchParams: Promise<{ area?: string; covering?: string; room?: string }> };

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 rounded-lg bg-[var(--secondary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--secondary)]">{children}</p>;
}

function Results({ r }: { r: CalcResult }) {
  const covering = COVERINGS.find((c) => c.value === r.input.covering)!;
  const room = ROOMS.find((x) => x.value === r.input.room)!;
  const nothing = !r.mats.length && !r.cables.length;
  return (
    <>
      <section className="mt-8 grid gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)] sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-2)]">Ваш запит</p>
          <p className="mt-1 font-semibold">
            {formatSpecNumber(r.input.area)} м² · {covering.label}
          </p>
          <p className="text-sm text-[var(--muted)]">{room.label}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-2)]">Рекомендована потужність</p>
          <p className="mt-1 text-2xl font-bold text-[var(--accent-dim)]">{r.density.target} Вт/м²</p>
          <p className="text-sm text-[var(--muted)]">
            допустимо {r.density.min}–{r.density.max} Вт/м² · {room.hint}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-2)]">Потрібна потужність</p>
          <p className="mt-1 text-2xl font-bold">≈ {r.neededPower} Вт</p>
          <p className="text-sm text-[var(--muted)]">{covering.hint}</p>
        </div>
      </section>

      {nothing ? (
        <div className="mt-8 rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] p-8 text-center text-[var(--muted)]">
          Для такої площі готового рішення в каталозі не знайшлося. Спробуйте змінити площу на ±10 % або{" "}
          <Link href="/#kontakty" className="font-medium text-[var(--accent-dim)] hover:underline">
            напишіть нам
          </Link>{" "}
          — підберемо комбінацію з кількох секцій.
        </div>
      ) : null}

      {r.mats.length ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold tracking-tight">
            {r.input.covering === "laminate" ? "Мати під ламінат" : "Нагрівальні мати"}{" "}
            <span className="text-sm font-normal text-[var(--muted)]">{r.mats.length} варіантів — мат не ріжуть, тому підбираємо площу не більшу за вільну</span>
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {r.mats.map((m) => (
              <div key={m.product.id}>
                <Note>
                  Покриє {formatSpecNumber(m.coverArea)} м² з {formatSpecNumber(r.input.area)} · {m.density} Вт/м² · {m.power} Вт
                </Note>
                <ProductCard product={m.product} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {r.cables.length ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold tracking-tight">
            {r.input.covering === "tile" ? "Тонкий кабель у плитковий клей" : "Кабель у стяжку"}{" "}
            <span className="text-sm font-normal text-[var(--muted)]">{r.cables.length} варіантів — кабель укладають з кроком під вашу площу</span>
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {r.cables.map((c) => (
              <div key={c.product.id}>
                <Note>
                  {c.power} Вт на {formatSpecNumber(r.input.area)} м² = {c.density} Вт/м² · крок ≈ {formatSpecNumber(c.stepCm)} см
                </Note>
                <ProductCard product={c.product} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!nothing && r.thermostats.length ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold tracking-tight">
            Терморегулятор <span className="text-sm font-normal text-[var(--muted)]">потрібен один на приміщення — від простого до Wi-Fi</span>
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {r.thermostats.map((t) => (
              <ProductCard key={t.id} product={t} />
            ))}
          </div>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Усі терморегулятори —{" "}
            <Link href="/catalog/termorehuliatory" className="font-medium text-[var(--secondary)] hover:underline">
              у розділі
            </Link>
            . До комплекту також потрібні гофра для датчика й монтажна стрічка — у частини позицій вони вже входять у «ціну комплекту».
          </p>
        </section>
      ) : null}
    </>
  );
}

export default async function CalcPage({ searchParams }: Props) {
  const sp = await searchParams;
  const input = parseCalcInput(sp);
  const result = input ? await calculate(input) : null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Підбір за площею" }]} />
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Підбір теплої підлоги за площею</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Вкажіть <strong className="text-[var(--foreground)]">вільну площу</strong> — без меблів без ніжок, сантехніки та кухонних тумб. Ми порахуємо потрібну
        потужність і покажемо мати або кабель, які підходять саме під неї.
      </p>

      <div className="mt-8 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)] sm:p-6">
        <CalcForm value={input} />
        {sp.area && !input ? <p className="mt-3 text-sm text-[var(--accent-dim)]">Вкажіть площу від 0,3 до 200 м².</p> : null}
      </div>

      {result ? (
        <Results r={result} />
      ) : (
        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            ["1. Площа", "Міряємо лише вільну підлогу: під шафою, ванною чи кухнею гріти не треба, а мат туди й не покласти."],
            ["2. Покриття", "Плитка — мат у клей; ламінат — алюмінієвий мат без стяжки; стяжка — класичний кабель."],
            ["3. Приміщення", "Ванна й балкон потребують більше Вт/м², ніж спальня. Основне опалення — 200 Вт/м² і теплоізоляція."],
          ].map(([h, t]) => (
            <div key={h} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="font-semibold">{h}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t}</p>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
