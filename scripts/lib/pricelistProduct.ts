/**
 * Формат файлу товару в data/catalog/<постачальник>/<sku>.json — один файл = один товар.
 * Файли генерує scripts/pricelists/parse_pricelists.py з прайсів у data/pricelists/;
 * імпортує в БД scripts/cli/import-pricelist-catalog.ts.
 */
export type PricelistSpec = {
  /** Slug SpecDefinition (power_w, area_m2, length_m, …). */
  slug: string;
  labelUk: string;
  /** Текстове значення як у прайсі (з одиницею або без). */
  value: string;
  /** Числове значення для фільтрів, якщо є. */
  number?: number | null;
  unit?: string | null;
};

export type PricelistProduct = {
  /** Унікальний id = externalId у БД: "<supplier>/<sku-slug>". */
  id: string;
  /** Ключ прайсу (папка в data/catalog). */
  supplier: string;
  /** Slug бренду з таксономії. */
  brand: string;
  /** Артикул/модель як у прайсі (SKU у БД буде "<sku>" з суфіксом за потреби). */
  sku: string;
  nameUk: string;
  /** Slug розділу каталогу (CATALOG_SECTIONS). */
  category: string;
  /** Slug-и міток (TAGS). */
  tags: string[];
  /** Роздрібна ціна, грн з ПДВ. null — «ціну уточнюйте». */
  priceUah: number | null;
  /** Ціна комплекту (секція + гофра + коробка / термостат), якщо в прайсі є. */
  priceKitUah?: number | null;
  /** Одиниця ціни: шт, м (погонний), м² (плівка). */
  priceUnit: "шт" | "м" | "м²";
  /** Примітка до ціни: «під замовлення», «акційна ціна», курс тощо. */
  priceNote?: string | null;
  shortDescription?: string | null;
  /** Опис: текст або HTML (абзаци), без inline-стилів. */
  description?: string | null;
  specs: PricelistSpec[];
  source: {
    /** Файл прайсу відносно кореня репозиторію. */
    file: string;
    sheet?: string;
    page?: number;
    /** Дата прайсу (YYYY-MM-DD). */
    date: string;
    /** Хто надіслав / від кого прайс. */
    supplierName?: string;
  };
};
