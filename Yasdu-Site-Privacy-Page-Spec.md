# Spec — the privacy policy as a bilingual HTML page on yasdu.com

Status: **Ready to build.** · Owner: product + whoever maintains yasdu.com ·
Audience: **the session that maintains the yasdu.com site**, which does not have
the Beats repository. Everything needed is either in this file or in the source
document it names.

Related, for context only (not required to build this):
`Privacy-Policy.md` and `MCP-Privacy-Disclosure.md` in the Beats repo,
`MCP-Publishing-Spec.md` MP7.

---

## 0. What this is

`www.yasdu.com/privacy` currently renders a heading, one paragraph about Y Tools,
and a **PDF embedded in a Google Docs viewer iframe**. The policy content was
updated on 2026-09-15 by replacing the PDF object; the surrounding page was not
touched.

This spec replaces that arrangement with a real HTML page, in **Spanish and
English**, at stable URLs.

## 1. Why HTML, not a PDF in a frame

Not a matter of taste. The PDF arrangement fails in five specific ways:

1. **Directory reviewers.** Beats' MCP connector is being submitted to the
   Claude Connectors Directory and OpenAI's app directory. Both require a
   published privacy policy, and a missing or unreadable one is an immediate
   rejection at Claude. A reviewer should not have to wait on a Docs viewer.
2. **The page contradicts its own contents.** The `<meta name="description">`
   still reads *"Política de privacidad de Y Tools y cumplimiento con Google API
   Services User Data Policy"* — so search results, link previews and anything
   that reads the page rather than the PDF announce it as another product's
   policy.
3. **Nothing can link to a section.** A submission form, a support reply or the
   app itself should be able to link to *"AI assistant connections"* directly.
4. **The filename is a lie.** `Privacy Policy v2 24112023.pdf` carries a
   November 2023 date on a document published in September 2026.
5. **Accessibility.** An iframed PDF viewer is poor for screen readers, poor on
   mobile, and unreadable with JavaScript unavailable.

## 2. Source content

**`Privacy Policy — Yasdu (corrected).md`** (delivered alongside this spec).

Use that file, not the currently published PDF and not the earlier `.md`. It is
the published text with two classes of defect repaired and **no substantive
change** — verified by word-level diff, 41 changed runs, all of them characters
or numbering:

- **Mojibake.** The published document was decoded as Mac-Roman at some point in
  its conversion: every em-dash surfaced as `‚` or `‚Äî`, and `§` as `¬ß` — 19
  characters in total. Two of those were arrows in menu paths
  (`Account → Connected assistants`), not dashes.
- **Numbering.** Two sections were both numbered 4.2.5; the retention section
  had lost its heading marker entirely and sat in the body as plain text
  `7\. How long we keep it`; and four Beats-wide sections — *Who we share
  information with*, *Where your data is stored*, *Your rights*, *Security* —
  were nested as `###` under *AI assistant connections*, which made them read as
  applying only to AI connections. They are now `##` siblings.

Section 4 (Beats) now runs 4.1 through 4.9 with one number each.

**Re-run the encoding check after any conversion step.** The file must contain
zero of `‚ Ä î ¬ ß` outside of legitimate Spanish text:

```bash
grep -c '‚\|‚Äî\|¬ß' "Privacy Policy — Yasdu (corrected).md"   # expect 0
```

## 3. URLs and language

The site already has a language toggle (the `EN`/`ES` control in the header) and
serves `<html lang="es">`. **Use the site's existing language mechanism** rather
than inventing one for this page.

Required:

- Both languages reachable at **stable, linkable URLs** — whatever shape the
  site already uses for bilingual content (`/privacy` + `/en/privacy`, or a
  query parameter, or path prefixes). Consistency with the rest of the site
  beats any particular scheme.
- `/privacy` must keep working. It is already linked from the site footer, and
  may be linked from elsewhere.
- `<link rel="alternate" hreflang="es">` and `hreflang="en"` between the two,
  plus `hreflang="x-default"`.
- The toggle preserves the section anchor when switching languages.

## 4. Structure

- One `<h1>`, then `<h2>`/`<h3>` following the source document's levels exactly.
  The heading hierarchy carries legal meaning here — see the nesting defect in
  §2.
- **Stable `id` anchors on every `<h2>` and `<h3>`**, derived from the section
  number, not the title: `#s4-4` for *4.4 AI assistant connections*. Title-derived
  slugs change when wording is edited and differ between languages; numeric ones
  survive both. The same anchor must address the same section in Spanish and
  English.
- A table of contents at the top, linking those anchors.
- The four tables in the source stay tables (`<table>`), not images.
- A visible **"Last updated"** date, matching the source.
- Keep a **downloadable PDF** as a secondary link if you want one — but generate
  it from the HTML so the two cannot drift, and name it with the real date, not
  `24112023`.

## 5. Metadata

Replace the Y Tools description. Suggested (adapt to house style):

| Field | Value |
| --- | --- |
| `<title>` | ES: `Política de Privacidad — Yasdu` · EN: `Privacy Policy — Yasdu` |
| `<meta name="description">` | ES: `Cómo Yasdu trata los datos personales en su sitio, Y Tools y Beats, incluidas las conexiones con asistentes de IA.` · EN: `How Yasdu handles personal data across its website, Y Tools and Beats, including AI assistant connections.` |
| `og:title` / `og:description` | Mirror the above. The current page inherits a generic site-wide OG description — that is wrong for a legal page. |

## 6. The Spanish version

The document is currently English. The Spanish version is a **translation of a
legal text**, not a UI string pass.

**Three rules that are not negotiable:**

1. **"Beats" and "a Beat" stay in English.** They are product terms. The Beats
   application itself keeps them untranslated across all six of its locales —
   Spanish included ("Este Beat está vacío", "En {n} Beats") — and the policy
   must match the product the reader is using. Do not translate to *"un
   Latido"*, *"un Pulso"* or similar.
2. **Register: match the site, not the app.** yasdu.com's Spanish is neutral and
   impersonal (*"Yasdu transforma cómo las empresas adoptan…"*). The Beats
   application's Spanish uses Argentine voseo (*"Vinculá"*, *"Podés"*), which
   would be wrong in a legal document for a Mexican entity. Use neutral Spanish
   with *usted* or impersonal constructions.
3. **Specific claims are load-bearing and were verified against the running
   code.** These must survive translation with their precision intact:

   | Claim | Must not become |
   | --- | --- |
   | Revocation: an already-issued token expires **within one hour** | "inmediatamente" / "immediately" |
   | Tokens stored **only as SHA-256 hashes**, not recoverable | any weaker "encrypted"/"cifrado" |
   | An assistant **sees exactly what you see, and nothing more** | "sólo datos autorizados" or similar softening |
   | **Your consent can expose your colleagues' data** — comments, names, emails | anything that softens or omits this |
   | Beats contains **no analytics, advertising or tracking technology** | a hedged "minimal analytics" |
   | Account deletion is **self-serve**, from *Account → Delete account* | "por solicitud" / "on request" |
   | Server logs retained **30 days** | any other number |

   The fourth row is the one a reviewer is looking for. It is unusual to
   disclose, and it is the reason the section is written the way it is.

**Decide and record: which language governs.** For a Mexican controller the
Spanish version is the natural authoritative text, with English offered for
convenience. Whichever you choose, state it in both versions (*"En caso de
discrepancia, prevalece la versión en español."*) — two equally-authoritative
translations of a legal document is a problem, not a feature.

## 7. What not to change

The legal text. This spec covers **presentation and translation only**. If a
substantive change looks necessary — a claim that seems wrong, a section that
seems missing — raise it rather than editing it: the factual claims were read
out of the Beats codebase and several are checkable assertions about how the
system behaves.

Two open items already known, neither blocking this page:

- **Server-log retention of 30 days** is a published commitment. It should be
  confirmed against the Google Cloud project's actual Cloud Logging retention
  (the `_Default` bucket is 30 days unless changed). If it differs, the policy
  needs correcting — not the page.
- **§1.5 and §4.6 disagree on where data lives.** The site-wide section says
  "United States, Europe, United Kingdom, or where our partners maintain
  facilities"; the Beats section says "United States". Both can be true, but a
  reader hitting §1.5 first gets a vaguer answer than the specific one. Worth
  reconciling in a later revision.

## 8. Acceptance

Buildable checks, in order:

1. Both language URLs return 200 and render the full policy **without
   JavaScript**.
2. `curl -s <url> | grep -c 'Política de privacidad de Y Tools'` returns 0 — the
   stale meta description is gone.
3. The encoding check in §2 returns 0 on the rendered page as well as the source.
4. Every `<h2>`/`<h3>` has an `id`, and the **same anchor resolves to the same
   section in both languages**.
5. Each row of the §6 claims table appears, correctly, in both languages.
6. `hreflang` links resolve in both directions.
7. The footer link to `/privacy` still works, and so does any existing inbound
   link to it.
8. Lighthouse accessibility pass on both, and a screen-reader spot check of the
   tables.

## 9. Decisions

1. **PS1 — HTML is canonical, the PDF is a derivative.** Where they disagree,
   the page wins. Generate the PDF from the page, or drop it. Two hand-maintained
   copies of a legal document will diverge, and the version a customer read is
   the one that matters in a dispute.
2. **PS2 — Anchors are numeric, not title-derived.** They must be stable across
   both languages and across wording edits, and a title-slug is neither.
3. **PS3 — Product terms are not translated.** "Beats" and "a Beat" appear in
   English in every language, matching the application.
4. **PS4 — One authoritative language, stated in the document.** Recommended:
   Spanish, given the controller is Yasdu Innovación y Servicios SA de CV,
   México. Confirm with whoever reviewed the policy.
