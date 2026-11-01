import { useMemo, type ReactNode } from "react";
import { useSessionStore } from "@iz/ui";
import { useBrowserStore } from "../browser/store.js";

/**
 * Network directory (§10.1). Primary source is the world's host table, which
 * the server now includes in every WorldSummary (DECISIONS D20: host, service,
 * title — no gate or canon data). Any host the browser has displayed is also
 * listed (covers in-fiction hosts reached by address before appearing in a
 * table refresh). Lock state is NOT derivable client-side (gate conditions
 * live in the bundle), so entries are not marked locked/unlocked; a locked
 * host simply resolves to the same indistinguishable "host not found" page.
 */
export function NetworkDirectory(): ReactNode {
  const world = useSessionStore((s) => s.world);
  const visitedHosts = useBrowserStore((s) => s.visitedHosts);
  const navigate = useBrowserStore((s) => s.navigate);

  const entryHost = useMemo(() => {
    if (world === undefined) return undefined;
    const slash = world.entry.indexOf("/");
    return slash === -1 ? world.entry : world.entry.slice(0, slash);
  }, [world]);

  const rows = useMemo(() => {
    const list: Array<{ host: string; service: string; title: string; origin: string }> = [];
    for (const h of world?.hosts ?? []) {
      list.push({
        host: h.host,
        service: h.service,
        title: h.title,
        origin: h.host === entryHost ? "start page" : "known host",
      });
    }
    for (const host of visitedHosts) {
      if (!list.some((h) => h.host === host)) {
        list.push({ host, service: "unknown", title: host, origin: "visited" });
      }
    }
    return list;
  }, [world, entryHost, visitedHosts]);

  return (
    <div className="iz-doc" data-view="network-directory">
      <h1>Network directory</h1>
      <p style={{ color: "var(--iz-dim)" }}>
        Hosts on this network. Not every listing answers — access depends on your case progress.
      </p>
      <table style={{ width: "100%" }}>
        <caption className="iz-visually-hidden">Known hosts</caption>
        <thead>
          <tr>
            <th scope="col">Host</th>
            <th scope="col">Service</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ host, service, title, origin }) => (
            <tr key={host}>
              <td>
                <a
                  href="#"
                  className="iz-doclink"
                  onClick={(e) => {
                    e.preventDefault();
                    void navigate(host, "/");
                  }}
                >
                  {title}
                </a>
                <span style={{ color: "var(--iz-faint)", fontSize: 12, marginLeft: 8 }}>{host}</span>
              </td>
              <td style={{ color: "var(--iz-dim)", fontSize: 12.5 }}>{service}</td>
              <td style={{ color: "var(--iz-faint)", fontSize: 12.5 }}>{origin}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p style={{ color: "var(--iz-faint)" }}>No hosts known yet.</p>}
    </div>
  );
}
