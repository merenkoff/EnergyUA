/**
 * Таксономія нового каталогу (товари з прайсів постачальників).
 *
 * Джерело правди для slug-ів розділів, міток і брендів. Парсер прайсів
 * (scripts/pricelists/parse_pricelists.py) пише ці ж slug-и у JSON-файли товарів,
 * імпортер (scripts/cli/import-pricelist-catalog.ts) відмовляється імпортувати
 * невідомий slug, щоб каталог не «розповзався».
 */

export { CATALOG_ROOT_SLUG, ARCHIVE_ROOT_SLUG, LEGACY_ROOT_SLUG, PRICELIST_SOURCE } from "../../src/lib/catalogRoot";

export type TaxonomyCategory = {
  slug: string;
  nameUk: string;
  nameRu?: string;
  description?: string;
  sortOrder: number;
};

/** Розділи каталогу — «папка» товару (одна на товар). Порядок = порядок на головній. */
export const CATALOG_SECTIONS: TaxonomyCategory[] = [
  {
    slug: "nahrivalni-maty",
    nameUk: "Нагрівальні мати",
    nameRu: "Нагревательные маты",
    description: "Мати на сітці для укладання в плитковий клей під плитку та камінь: Hemstedt, Fenix, Nexans, Arnold Rak, Magnum та інші.",
    sortOrder: 10,
  },
  {
    slug: "nahrivalnyi-kabel",
    nameUk: "Нагрівальний кабель",
    nameRu: "Нагревательный кабель",
    description: "Секції двожильного та одножильного кабелю: тонкий у плитковий клей і класичний у стяжку.",
    sortOrder: 20,
  },
  {
    slug: "pid-laminat",
    nameUk: "Під ламінат і паркет",
    nameRu: "Под ламинат и паркет",
    description: "Алюмінієві мати, мати у фользі та інфрачервона плівка для сухого монтажу без стяжки.",
    sortOrder: 30,
  },
  {
    slug: "termorehuliatory",
    nameUk: "Терморегулятори",
    nameRu: "Терморегуляторы",
    description: "Механічні, програмовані, сенсорні та Wi-Fi термостати для теплої підлоги, DIN-контролери.",
    sortOrder: 40,
  },
  {
    slug: "samorehuliuiuchyi-kabel",
    nameUk: "Саморегулюючий кабель",
    nameRu: "Саморегулирующийся кабель",
    description: "Відрізний кабель для труб, водостоків і покрівлі: ціна за погонний метр.",
    sortOrder: 50,
  },
  {
    slug: "antyobledeninnia",
    nameUk: "Сніготанення та антиобледеніння",
    nameRu: "Снеготаяние и антиобледенение",
    description: "Кабель для покрівлі, водостоків, труб і відкритих майданчиків, контролери та датчики вологості й температури.",
    sortOrder: 60,
  },
  {
    slug: "montazh-ta-aksesuary",
    nameUk: "Датчики та монтажні матеріали",
    nameRu: "Датчики и монтажные материалы",
    description: "Датчики температури, монтажна стрічка, гофра, муфти, ремонтні комплекти, кріплення.",
    sortOrder: 70,
  },
  {
    slug: "rushnykosusharky",
    nameUk: "Електричні рушникосушарки",
    nameRu: "Электрические полотенцесушители",
    sortOrder: 80,
  },
  {
    slug: "infrachervoni-obihrivachi",
    nameUk: "Інфрачервоні обігрівачі",
    nameRu: "Инфракрасные обогреватели",
    description: "Стельові високотемпературні панелі для приміщень з високою стелею та локального обігріву.",
    sortOrder: 90,
  },
  {
    slug: "kylymky-z-pidihrivom",
    nameUk: "Килимки з підігрівом",
    nameRu: "Коврики с подогревом",
    sortOrder: 100,
  },
  {
    slug: "enerhetyka",
    nameUk: "Інвертори, акумулятори, зарядні станції",
    nameRu: "Инверторы, аккумуляторы, зарядные станции",
    description: "Гібридні інвертори Deye, LiFePO4-акумулятори та портативні зарядні станції.",
    sortOrder: 110,
  },
  {
    slug: "zakhyst-vid-protikannia",
    nameUk: "Захист від протікання води",
    nameRu: "Защита от протечек воды",
    sortOrder: 120,
  },
  {
    slug: "zazemlennia",
    nameUk: "Заземлення та блискавкозахист",
    nameRu: "Заземление и молниезащита",
    sortOrder: 130,
  },
];

export { TAG_GROUPS, type TagGroupDef as TaxonomyTagGroup } from "../../src/lib/tagGroups";

export type TaxonomyTag = { slug: string; nameUk: string; groupSlug: string; sortOrder: number; description?: string };

function group(groupSlug: string, rows: Array<[slug: string, nameUk: string, description?: string]>): TaxonomyTag[] {
  return rows.map(([slug, nameUk, description], i) => ({ slug, nameUk, groupSlug, sortOrder: (i + 1) * 10, description }));
}

export const TAGS: TaxonomyTag[] = [
  ...group("zastosuvannia", [
    ["pid-plytku", "Під плитку", "Монтаж у плитковий клей або самовирівнюючу суміш."],
    ["pid-laminat", "Під ламінат і паркет", "Сухий монтаж на підкладку без стяжки."],
    ["u-stiazhku", "У стяжку", "Кабель у цементно-піщану стяжку 3–6 см."],
    ["vidkryti-maidanchyky", "Відкриті майданчики, сходи, доріжки"],
    ["vodostoky-ta-pokrivlia", "Водостоки та покрівля"],
    ["truby", "Обігрів труб"],
    ["vanna", "Ванна кімната"],
    ["dlia-domu", "Побутове застосування"],
  ]),
  ...group("konstruktsiia", [
    ["dvozhylnyi", "Двожильний"],
    ["odnozhylnyi", "Одножильний"],
    ["tonkyi-kabel", "Тонкий кабель (до 4,5 мм)"],
    ["ultratonkyi", "Ультратонкий (до 3 мм)"],
    ["samokleiucha-sitka", "Самоклеюча сітка"],
    ["aliuminiievyi-mat", "Алюмінієвий мат"],
    ["plivka", "Інфрачервона плівка"],
    ["z-vbudovanym-termostatom", "З вбудованим термостатом і вилкою"],
    ["vidriznyi", "Відрізний (ціна за метр)"],
    ["ftoroplastova-izoliatsiia", "Фторопластова внутрішня ізоляція"],
    ["bezmuftove-ziednannia", "Безмуфтове з’єднання"],
  ]),
  ...group("funktsii", [
    ["mekhanichnyi", "Механічний"],
    ["tsyfrovyi", "Цифровий"],
    ["prohramovanyi", "Програмований"],
    ["sensornyi", "Сенсорний"],
    ["wi-fi", "Wi-Fi"],
    ["zigbee", "Zigbee"],
    ["din-reika", "На DIN-рейку"],
    ["dvozonnyi", "Двозонний"],
    ["datchyk-pidlohy", "Датчик підлоги"],
    ["datchyk-povitria", "Датчик повітря"],
    ["dlia-snihotanennia", "Контролер сніготанення"],
    ["dlia-hazovoho-kotla", "Для газового котла"],
  ]),
  ...group("potuzhnist", [
    ["140-vt-m2", "140 Вт/м²"],
    ["150-vt-m2", "150 Вт/м²"],
    ["160-vt-m2", "160 Вт/м²"],
    ["175-vt-m2", "175 Вт/м²"],
    ["180-vt-m2", "180 Вт/м²"],
    ["200-vt-m2", "200 Вт/м²"],
    ["220-vt-m2", "220 Вт/м²"],
    ["400-vt-m2", "400 Вт/м²"],
    ["10-vt-m", "10 Вт/м"],
    ["12-vt-m", "12 Вт/м"],
    ["12-5-vt-m", "12,5 Вт/м"],
    ["15-vt-m", "15 Вт/м"],
    ["16-5-vt-m", "16,5 Вт/м"],
    ["17-vt-m", "17 Вт/м"],
    ["17-5-vt-m", "17,5 Вт/м"],
    ["18-vt-m", "18 Вт/м"],
    ["19-vt-m", "19 Вт/м"],
    ["20-vt-m", "20 Вт/м"],
    ["25-vt-m", "25 Вт/м"],
    ["27-vt-m", "27 Вт/м"],
    ["28-vt-m", "28 Вт/м"],
    ["30-vt-m", "30 Вт/м"],
  ]),
  ...group("kraina", [
    ["nimechchyna", "Німеччина"],
    ["chekhiia", "Чехія"],
    ["niderlandy", "Нідерланди"],
    ["norvehiia", "Норвегія"],
    ["daniia", "Данія"],
    ["frantsiia", "Франція"],
    ["shveitsariia", "Швейцарія"],
    ["polshcha", "Польща"],
    ["latviia", "Латвія"],
    ["koreia", "Корея"],
    ["ukraina", "Україна"],
    ["kytai", "Китай"],
  ]),
  ...group("komplektatsiia", [
    ["z-komplektom", "Є ціна комплекту (гофра, коробка)"],
    ["aktsiia", "Акційна ціна"],
    ["pid-zamovlennia", "Під замовлення"],
  ]),
];

export type TaxonomyBrand = {
  slug: string;
  name: string;
  /** Slug мітки країни (група kraina), якщо для бренду вона однозначна. */
  country?: string;
  /** Офіційний сайт — джерело фото, описів і актуальних характеристик (етап 2). */
  site?: string;
};

export const BRANDS: TaxonomyBrand[] = [
  { slug: "arnold-rak", name: "Arnold Rak", country: "nimechchyna", site: "https://www.arnold-rak.de" },
  { slug: "ryxon", name: "Ryxon", country: "latviia", site: "https://ryxon.eu" },
  { slug: "flex", name: "Flex", country: "latviia" },
  { slug: "heat-plus", name: "Heat Plus", site: "https://heatplus.com.ua" },
  { slug: "smart", name: "SMART" },
  { slug: "hemstedt", name: "Hemstedt", country: "nimechchyna", site: "https://www.hemstedt.de" },
  { slug: "fenix", name: "Fenix", country: "chekhiia", site: "https://www.fenixgroup.cz" },
  { slug: "in-therm", name: "IN-THERM", site: "https://in-therm.ua" },
  { slug: "eberle", name: "Eberle", country: "nimechchyna", site: "https://www.eberle.de" },
  { slug: "eltrace", name: "Eltrace", country: "frantsiia", site: "https://www.eltrace.com" },
  { slug: "deye", name: "Deye", country: "kytai", site: "https://www.deyeinverter.com" },
  { slug: "bluetti", name: "Bluetti", site: "https://www.bluettipower.eu" },
  { slug: "allpowers", name: "Allpowers", site: "https://www.allpowers.com" },
  { slug: "bluesun", name: "Bluesun", country: "kytai", site: "https://www.bluesunpv.com" },
  { slug: "hysincere", name: "Hysincere" },
  { slug: "mfuzop", name: "MFUZOP" },
  { slug: "datou-boss", name: "Datou Boss" },
  { slug: "dyness", name: "Dyness", site: "https://www.dyness.com" },
  { slug: "nexans", name: "Nexans", country: "norvehiia", site: "https://www.nexans.com" },
  { slug: "warme", name: "Wärme", site: "https://warme.com.ua" },
  { slug: "profitherm", name: "Profi Therm", site: "https://profitherm.ua" },
  { slug: "oj-electronics", name: "OJ Electronics", country: "daniia", site: "https://ojelectronics.com" },
  { slug: "zuver", name: "Zuver" },
  { slug: "akvablok", name: "Акваблок" },
  { slug: "extherm", name: "Extherm", country: "nimechchyna", site: "https://extherm.com.ua" },
  { slug: "easytherm", name: "Easytherm", site: "https://easytherm.com.ua" },
  { slug: "hot-fly", name: "Hot Fly" },
  { slug: "shtoller", name: "Shtoller (Ecotherm)", country: "nimechchyna" },
  { slug: "magnum", name: "Magnum", country: "niderlandy", site: "https://magnumheating.com" },
  { slug: "hts-global", name: "HTS Global (eHeat)", country: "shveitsariia" },
  { slug: "mhw", name: "MHW" },
  { slug: "terneo", name: "Terneo", country: "ukraina", site: "https://terneo.ua" },
  { slug: "ecoterm", name: "EcoTerm" },
  { slug: "castle", name: "Castle" },
];

export const SECTION_SLUGS = new Set(CATALOG_SECTIONS.map((c) => c.slug));
export const TAG_SLUGS = new Set(TAGS.map((t) => t.slug));
export const BRAND_SLUGS = new Set(BRANDS.map((b) => b.slug));
