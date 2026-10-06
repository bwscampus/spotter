/**
 * Hosts whose events are dropped. Anything served from a development machine:
 * localhost however it is spelled, the loopback addresses, and the .local and
 * .test names a phone on the same network uses to reach a dev server.
 *
 * A week of building and testing looks exactly like a very busy announcer,
 * which is worse than no data at all.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const LOCAL_SUFFIXES = [".local", ".localhost", ".test"];

/**
 * True when this page or request came from a development machine.
 *
 * Takes a host with or without its port, from `location.hostname` in the
 * browser or the Host header on the server, so both sides decide the same way.
 */
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let name = host.trim().toLowerCase();

  // Drop the port. An IPv6 host is bracketed when it carries one ("[::1]:3000"),
  // and bare "::1" is all colons, so a plain trailing-port strip would eat it.
  const bracket = name.indexOf("]");
  if (name.startsWith("[") && bracket > 0) name = name.slice(1, bracket);
  else if ((name.match(/:/g) ?? []).length === 1) name = name.replace(/:\d+$/, "");

  if (LOCAL_HOSTS.has(name)) return true;
  return LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}
