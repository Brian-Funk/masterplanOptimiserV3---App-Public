const ALLOWED_TAGS = new Set(["A", "B", "BR", "EM", "I", "STRONG", "U"]);
const ALLOWED_LINK_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

function safeHref(value: string): string | null {
  if (!value || value.startsWith("//") || /[\u0000-\u001f]/.test(value)) return null;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const parsed = new URL(value);
    return ALLOWED_LINK_SCHEMES.has(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

function appendSanitisedNode(source: Node, target: Node): void {
  if (source.nodeType === Node.TEXT_NODE) {
    target.appendChild(document.createTextNode(source.textContent || ""));
    return;
  }
  if (!(source instanceof HTMLElement)) return;

  if (!ALLOWED_TAGS.has(source.tagName)) {
    if (source.tagName !== "SCRIPT" && source.tagName !== "STYLE" && source.tagName !== "TEMPLATE") {
      source.childNodes.forEach((child) => appendSanitisedNode(child, target));
    }
    return;
  }

  const clean = document.createElement(source.tagName.toLowerCase());
  if (source.tagName === "A") {
    const href = safeHref(source.getAttribute("href") || "");
    if (!href) {
      source.childNodes.forEach((child) => appendSanitisedNode(child, target));
      return;
    }
    clean.setAttribute("href", href);
  }
  source.childNodes.forEach((child) => appendSanitisedNode(child, clean));
  target.appendChild(clean);
}

/** Defence-in-depth for rich templates loaded from persisted or imported data. */
export function sanitiseRichTemplateHtml(value: string): string {
  const source = document.createElement("template");
  source.innerHTML = value;
  const target = document.createElement("div");
  source.content.childNodes.forEach((child) => appendSanitisedNode(child, target));
  return target.innerHTML;
}
