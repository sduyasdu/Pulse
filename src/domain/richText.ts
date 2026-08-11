// Allowlist sanitiser for the notes rich text (task notes and subtask notes).
//
// Notes are written by one collaborator and rendered in every other member's
// browser through `innerHTML`, so whatever we store is markup that executes on
// someone else's machine. Both ends are therefore filtered: what the editor
// emits (so the hostile payload never reaches Firestore) and what it renders
// back (so documents written before this existed, or by any other client, are
// still safe to display).
//
// The rule is an allowlist, not a blocklist: a tag we don't know is unwrapped —
// its text survives, its markup doesn't — and every attribute is dropped except
// a scheme-checked `href` and `src`. That means no `on*` handler, no inline
// `style`, and no `javascript:` URL can survive, whatever shape it arrives in.

/** Tags kept as-is. Everything else is unwrapped or dropped (see DROP_WITH_CONTENT). */
const ALLOWED_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL",
  "A", "IMG", "BR", "P", "DIV", "SPAN",
  "UL", "OL", "LI",
  "H3", "H4", "BLOCKQUOTE", "CODE", "PRE",
]);

/** Tags whose *text* is not content — unwrapping these would paste script
 * source or CSS into the note as visible text, so they go entirely. */
const DROP_WITH_CONTENT = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "TITLE",
  "SVG", "MATH", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "TEMPLATE", "NOSCRIPT",
]);

const SAFE_HREF = /^(?:https?:|mailto:|tel:)/i;
/** Remote images and pasted screenshots (data: URIs), nothing else — no
 * `javascript:`, and no `data:text/html` smuggled in behind an <img>. */
const SAFE_SRC = /^(?:https?:|data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,)/i;

/** Attributes kept, per tag. Everything not listed here is removed. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href"]),
  IMG: new Set(["src", "alt"]),
};

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** Sanitise a stored/pasted HTML fragment down to the allowlist above. */
export function sanitizeRichText(html: string): string {
  if (!html) return "";
  // DOMParser builds an inert document: no script runs and no subresource is
  // fetched from it, so parsing a hostile payload here is itself harmless.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    // The tree is mutated as we walk it; anything already detached with its
    // parent has nothing left to contribute.
    if (!el.isConnected) continue;
    const tag = el.tagName.toUpperCase();

    if (DROP_WITH_CONTENT.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(el);
      continue;
    }

    const allowed = ALLOWED_ATTRS[tag];
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      const ok =
        allowed?.has(name) &&
        (name === "href" ? SAFE_HREF.test(value) : name === "src" ? SAFE_SRC.test(value) : true);
      if (!ok) el.removeAttribute(attr.name);
    }

    // A link that lost its href (because the scheme was rejected) is no longer
    // a link — keep the text, drop the anchor. Survivors open safely.
    if (tag === "A") {
      if (!el.getAttribute("href")) unwrap(el);
      else {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer nofollow");
      }
    }
    // Likewise an image with no usable source is just an empty box.
    if (tag === "IMG" && !el.getAttribute("src")) el.remove();
  }

  return doc.body.innerHTML;
}

/** True when a fragment carries no visible content — only whitespace and the
 * browser's "empty contentEditable" filler (a bare <br>, an empty paragraph).
 * Images and list items count as content even though they have no text. */
export function isRichTextEmpty(html: string): boolean {
  if (!html.trim()) return true;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  if (doc.body.textContent?.trim()) return false;
  return !doc.body.querySelector("img, li");
}

/** Normalise a user-typed link target: bare domains get https://, and anything
 * whose scheme we won't render is rejected outright (returns null). */
export function normalizeLinkHref(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//") ? raw.replace(/^\/\//, "https://") : `https://${raw}`;
  return SAFE_HREF.test(withScheme) ? withScheme : null;
}
