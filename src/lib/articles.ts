import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { marked, type Tokens } from "marked";

/**
 * Статті для SEO/AEO: markdown-файли в content/articles/<slug>.md з простим frontmatter
 * (title, description, date, updated, category, keywords). Секція «## Часті питання» з «### запитання»
 * стає блоком FAQ і FAQPage у JSON-LD. Файли комітяться в репозиторій, адмінки для них поки немає.
 */

export const ARTICLE_CATEGORIES: Record<string, string> = {
  remont: "Ремонт",
  montazh: "Монтаж",
  vybir: "Вибір",
  ekspluatatsiia: "Експлуатація",
};

export type ArticleMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated: string;
  category: string;
  categoryLabel: string;
  keywords: string[];
  readingMinutes: number;
};

export type ArticleFaq = { question: string; answer: string };
export type ArticleHeading = { id: string; text: string };

export type Article = ArticleMeta & {
  html: string;
  faq: ArticleFaq[];
  headings: ArticleHeading[];
};

const DIR = path.join(process.cwd(), "content", "articles");
const FAQ_HEADING = /^часті питання/i;

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: raw.slice(m[0].length) };
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch",
  ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ё: "e", ъ: "",
};

/** id для якорів заголовків: транслітерація (латиниця, щоб посилання з якорем не перетворювалось на %D0…). */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[а-яёіїєґ]/g, (ch) => TRANSLIT[ch] ?? ch)
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

/** marked екранує текст заголовків (&#39;, &amp;…); для змісту та id повертаємо звичайні символи. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function plainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Розбиває markdown на основний текст і FAQ (секція «## Часті питання» → пари запитання/відповідь). */
function splitFaq(body: string): { main: string; faq: ArticleFaq[]; faqMd: string } {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+/.test(l) && FAQ_HEADING.test(l.replace(/^##\s+/, "")));
  if (start < 0) return { main: body, faq: [], faqMd: "" };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const faqLines = lines.slice(start + 1, end);
  const faq: ArticleFaq[] = [];
  let q: string | null = null;
  let a: string[] = [];
  const flush = () => {
    if (q) faq.push({ question: q, answer: plainText(a.join("\n")) });
  };
  for (const l of faqLines) {
    const h = l.match(/^###\s+(.+)$/);
    if (h) {
      flush();
      q = h[1].trim();
      a = [];
    } else if (q) a.push(l);
  }
  flush();
  const main = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  return { main, faq, faqMd: faqLines.join("\n") };
}

function renderMarkdown(md: string, headings: ArticleHeading[]): string {
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }: Tokens.Heading) => {
    const text = renderer.parser.parseInline(tokens);
    const plain = plainText(decodeEntities(text.replace(/<[^>]+>/g, "")));
    const id = headingId(plain.replace(/['’]/g, ""));
    if (depth === 2) headings.push({ id, text: plain });
    return `<h${depth} id="${id}">${text}</h${depth}>\n`;
  };
  renderer.link = ({ href, title, tokens }: Tokens.Link) => {
    const text = renderer.parser.parseInline(tokens);
    const external = /^https?:\/\//.test(href);
    const attrs = external ? ' target="_blank" rel="noopener"' : "";
    return `<a href="${href}"${title ? ` title="${title}"` : ""}${attrs}>${text}</a>`;
  };
  return marked.parse(md, { renderer, gfm: true, async: false }) as string;
}

function toArticle(slug: string, raw: string): Article {
  const { meta, body } = parseFrontmatter(raw);
  const { main, faq, faqMd } = splitFaq(body);
  const headings: ArticleHeading[] = [];
  const html = renderMarkdown(main, headings);
  const faqHtml = faqMd ? renderMarkdown(faqMd, []) : "";
  const words = plainText(body).split(/\s+/).filter(Boolean).length;
  const category = meta.category ?? "vybir";
  return {
    slug,
    title: meta.title ?? slug,
    description: meta.description ?? "",
    date: meta.date ?? "",
    updated: meta.updated ?? meta.date ?? "",
    category,
    categoryLabel: ARTICLE_CATEGORIES[category] ?? category,
    keywords: (meta.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
    readingMinutes: Math.max(1, Math.round(words / 180)),
    html: html + (faqHtml ? `\n<h2 id="chasti-pytannia">Часті питання</h2>\n${faqHtml}` : ""),
    faq,
    headings: faq.length ? [...headings, { id: "chasti-pytannia", text: "Часті питання" }] : headings,
  };
}

export async function listArticles(): Promise<ArticleMeta[]> {
  let files: string[] = [];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const items = await Promise.all(
    files.map(async (f) => {
      const raw = await readFile(path.join(DIR, f), "utf8");
      const a = toArticle(f.replace(/\.md$/, ""), raw);
      const { html: _html, faq: _faq, headings: _h, ...meta } = a;
      void _html;
      void _faq;
      void _h;
      return meta;
    }),
  );
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title, "uk")));
}

export async function getArticle(slug: string): Promise<Article | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const raw = await readFile(path.join(DIR, `${slug}.md`), "utf8");
    return toArticle(slug, raw);
  } catch {
    return null;
  }
}

export function formatArticleDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(d);
}
