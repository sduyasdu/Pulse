import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no layout engine, so it implements none of the scrolling API — but
 * it does not stub it either: `element.scrollIntoView` is simply undefined, and
 * any component that calls it throws inside an effect. That is an environment
 * gap, not an app bug (every browser has it), so it is filled here rather than
 * guarded at each call site, which would leave defensive `?.` scattered through
 * components to satisfy a test runner.
 */
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
