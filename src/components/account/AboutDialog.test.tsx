import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";

/** About is almost entirely constants, and constants are exactly what rots
 * silently: a renamed asset, a dropped rel, a version block that quietly
 * reports nothing. These assert the parts that have no other guard. */
describe("AboutDialog", () => {
  it("names itself for assistive tech", () => {
    render(<AboutDialog onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("About Pulse");
  });

  it("shows the Yasdu attribution and the legal entity", () => {
    render(<AboutDialog onClose={() => {}} />);
    // The asset lives in public/brand/ — a rename here is a broken image in
    // production and nothing else would catch it.
    expect(screen.getByAltText("Yasdu")).toHaveAttribute("src", "/brand/yasdu-lockup-light.png");
    expect(screen.getByText(/Pulse is a Yasdu product/)).toBeTruthy();
    expect(screen.getByText(/Yasdu Innovación y Servicios SA de CV · México/)).toBeTruthy();
  });

  it("reports the build, so a bug report can identify it", () => {
    render(<AboutDialog onClose={() => {}} />);
    expect(screen.getByText(new RegExp(__APP_COMMIT__))).toBeTruthy();
    expect(screen.getByText(new RegExp(__APP_BUILT__))).toBeTruthy();
  });

  it("opens yasdu.com in a new tab without handing over the opener", () => {
    render(<AboutDialog onClose={() => {}} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://yasdu.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<AboutDialog onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalled();
  });
});
