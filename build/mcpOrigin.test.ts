import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The connector speaks from exactly one origin.
 *
 * The connector URL shown in the app, the OAuth issuer, the discovery
 * documents and the 401 challenge must all name the same host. A mismatch is
 * the mixed-origin arrangement that `firebase.json` warns some clients refuse
 * outright and that `ConnectedAssistantsDialog` records as having already
 * broken client registration once — and it breaks in the customer's assistant,
 * where the error is unreadable.
 *
 * These live in two packages that never import each other, so nothing but this
 * keeps them in step.
 */
const server = readFileSync("functions/src/mcpServer.ts", "utf8");
const client = readFileSync("src/components/account/ConnectedAssistantsDialog.tsx", "utf8");
const registry = JSON.parse(readFileSync("server.json", "utf8")) as {
  version: string;
  remotes: { type: string; url: string }[];
};

const hostOf = (url: string) => new URL(url).host;

describe("one origin, named in one place", () => {
  const issuer = /^const ISSUER = "([^"]+)";$/m.exec(server)?.[1];
  const connectorUrl = /^const MCP_URL = "([^"]+)";$/m.exec(client)?.[1];

  it("finds both declarations", () => {
    // Without this the two cases below pass vacuously if either constant is
    // renamed or reformatted.
    expect(issuer, "ISSUER in mcpServer.ts").toBeDefined();
    expect(connectorUrl, "MCP_URL in ConnectedAssistantsDialog.tsx").toBeDefined();
  });

  it("serves the connector from the issuer's own host", () => {
    expect(hostOf(connectorUrl!)).toBe(hostOf(issuer!));
  });

  it("derives the 401 challenge from the issuer rather than repeating a host", () => {
    // Repeating it is two places to change and one to forget; that is how the
    // challenge ended up pointing at the old brand after the domain moved.
    expect(server).toMatch(/resource_metadata="\$\{ISSUER\}/);
    expect(server).not.toMatch(/resource_metadata="https:\/\//);
  });

  it("advertises every endpoint on that host", () => {
    for (const line of ["MCP_URL", "TOKEN_URL", "REGISTER_URL"]) {
      const m = new RegExp(`^const ${line} = \`([^\`]+)\`;$`, "m").exec(server);
      expect(m?.[1], line).toMatch(/^\$\{ISSUER\}/);
    }
  });
});

/**
 * What the registry advertises must match what the server is.
 *
 * `server.json` is published to the official MCP registry, where it becomes the
 * description clients discover before they ever reach the server. A version or
 * a URL that disagrees with the running code tells a client one thing and the
 * server another, and nothing in either package would notice — the file is not
 * imported by anything.
 */
describe("the registry entry describes the running server", () => {
  const info = /const SERVER_INFO = \{ name: "[^"]+", title: "[^"]+", version: "([^"]+)" \}/.exec(server);
  const issuer = /^const ISSUER = "([^"]+)";$/m.exec(server)?.[1];

  it("finds the server's own declarations", () => {
    expect(info?.[1], "SERVER_INFO version").toBeDefined();
    expect(issuer, "ISSUER").toBeDefined();
  });

  it("publishes the version the server reports", () => {
    expect(registry.version).toBe(info![1]);
  });

  it("points at the endpoint on the issuer's host", () => {
    expect(registry.remotes[0].url).toBe(`${issuer}/mcp`);
  });

  it("declares streamable-http, which is what the server implements", () => {
    // It negotiates `text/event-stream` on the POST endpoint. Declaring the
    // deprecated standalone `sse` transport would describe a server that does
    // not exist here.
    expect(registry.remotes[0].type).toBe("streamable-http");
    expect(server).toMatch(/text\/event-stream/);
  });
});
