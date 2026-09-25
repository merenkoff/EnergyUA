"use client";

import { useState } from "react";

type Img = { url: string; altUk: string | null };

/** Галерея товару: велике фото + мініатюри. Без бібліотек — клік по мініатюрі міняє головне фото. */
export function ProductGallery({ images, name }: { images: Img[]; name: string }) {
  const [i, setI] = useState(0);
  const cur = images[i] ?? images[0];

  if (!images.length) {
    return (
      <div className="product-photo flex aspect-square items-center justify-center rounded-[var(--radius)] border border-[var(--border)] text-sm text-[var(--muted-2)]">
        Фото готується
      </div>
    );
  }

  return (
    <div>
      <div className="product-photo relative aspect-square overflow-hidden rounded-[var(--radius)] border border-[var(--border)] shadow-[var(--shadow-sm)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur.url} alt={cur.altUk ?? name} className="h-full w-full object-contain p-6" />
      </div>
      {images.length > 1 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {images.map((im, k) => (
            <button
              key={im.url + k}
              type="button"
              onClick={() => setI(k)}
              aria-label={`Фото ${k + 1}`}
              className={`product-photo h-16 w-16 shrink-0 overflow-hidden rounded-lg border transition ${
                k === i ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt="" className="h-full w-full object-contain p-1" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
