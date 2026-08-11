import { describe, expect, it } from "vitest";
import { isRichTextEmpty, normalizeLinkHref, sanitizeRichText } from "./richText";

describe("sanitizeRichText", () => {
  it("keeps the formatting the editor produces", () => {
    const html = "<b>bold</b> <i>it</i> <u>u</u> <s>gone</s><ul><li>one</li></ul><h3>head</h3>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("strips event handlers while keeping the element", () => {
    const out = sanitizeRichText('<p onclick="steal()" onmouseover="x()">hi</p>');
    expect(out).toBe("<p>hi</p>");
  });

  // The payload that motivates all of this: innerHTML does not run <script>,
  // but it very much runs an error handler on a broken image.
  it("drops an img whose onerror would fire in a teammate's browser", () => {
    const out = sanitizeRichText('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  it("removes script and style content entirely rather than unwrapping it", () => {
    const out = sanitizeRichText('<p>keep</p><script>alert(1)</script><style>body{display:none}</style>');
    expect(out).toBe("<p>keep</p>");
  });

  it("unwraps unknown tags but keeps their text", () => {
    expect(sanitizeRichText("<table><tr><td>cell</td></tr></table>")).toBe("cell");
    expect(sanitizeRichText('<font color="red">text</font>')).toBe("text");
  });

  it("drops pasted inline styles and classes", () => {
    const out = sanitizeRichText('<span style="font-size:72px;color:red" class="MsoNormal">word</span>');
    expect(out).toBe("<span>word</span>");
  });

  it("rejects javascript: links but keeps their text", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">click</a>')).toBe("click");
    expect(sanitizeRichText('<a href="JaVaScRiPt:alert(1)">click</a>')).toBe("click");
  });

  it("keeps http(s) and mailto links, hardened for a new tab", () => {
    const out = sanitizeRichText('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(sanitizeRichText('<a href="mailto:a@b.com">m</a>')).toContain("mailto:a@b.com");
  });

  it("allows pasted screenshots but not data: html", () => {
    expect(sanitizeRichText('<img src="data:image/png;base64,AAA">')).toContain("data:image/png;base64,AAA");
    expect(sanitizeRichText('<img src="data:text/html;base64,PHNjcmlwdD4=">')).toBe("");
  });

  it("survives malformed and nested-hostile markup", () => {
    expect(sanitizeRichText("<div><p>a</div></p>")).toContain("a");
    // A naive regex blocklist would leave a live <script> behind here.
    expect(sanitizeRichText("<scr<script>ipt>alert(1)</script>")).not.toContain("<script");
  });

  it("is a no-op on empty input", () => {
    expect(sanitizeRichText("")).toBe("");
  });
});

describe("isRichTextEmpty", () => {
  it("treats the browser's empty-editor filler as empty", () => {
    expect(isRichTextEmpty("")).toBe(true);
    expect(isRichTextEmpty("<br>")).toBe(true);
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty("   ")).toBe(true);
  });

  it("treats text, images and list items as content", () => {
    expect(isRichTextEmpty("<p>hi</p>")).toBe(false);
    expect(isRichTextEmpty('<img src="data:image/png;base64,AAA">')).toBe(false);
    expect(isRichTextEmpty("<ul><li></li></ul>")).toBe(false);
  });
});

describe("normalizeLinkHref", () => {
  it("adds https:// to a bare domain", () => {
    expect(normalizeLinkHref("example.com/a")).toBe("https://example.com/a");
    expect(normalizeLinkHref("//example.com")).toBe("https://example.com");
  });

  it("leaves an explicit safe scheme alone", () => {
    expect(normalizeLinkHref("http://x.com")).toBe("http://x.com");
    expect(normalizeLinkHref("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("rejects unsafe schemes and blanks", () => {
    expect(normalizeLinkHref("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkHref("data:text/html,x")).toBeNull();
    expect(normalizeLinkHref("   ")).toBeNull();
  });
});
