const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export async function fetchHtml(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} для ${url}`);
  }
  return res.text();
}

export function assertNotAntiBot(html: string, label: string) {
  if (html.includes("adm.tools") && html.includes("___ack")) {
    throw new Error(
      `${label}: отримано захисну сторінку (JavaScript challenge). Збережіть HTML з браузера (Ctrl+S) і передайте --file, або використайте Playwright.`,
    );
  }
}
