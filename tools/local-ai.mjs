// For local testing only: saves one AI setup, a model on this computer (Ollama), for all
// the Neem Chowk sites, so it is not typed into each one. tools/dev.mjs --local-ai runs it.
//
// The runtime (runtime/byok.js) reads a visitor's setups from a cookie on loopback hosts,
// and a cookie belongs to a host name on every port. One visit to this server sets that
// cookie on 127.0.0.1, then localhost, then [::1], and ends on NearShelf. Other saved
// setups in the cookie stay. No real key is involved: Ollama ignores it.
import http from "node:http";

export const SETUP_PORT = 8090;
const COOKIE = "nsweb_byok_profiles_v1";
const HOSTS = ["127.0.0.1", "localhost", "[::1]"];
const MOST_PROFILES = 12;
// The runtime's own limit for the cookie.
const MOST_COOKIE = 3800;
export const PROFILE = {
  id: "local-ollama",
  name: "Local Ollama (testing)",
  key: "ollama",
  model: process.env.LOCAL_AI_MODEL || "qwen3-vl:4b-instruct",
  router: "http://localhost:11434/v1",
  runner: false,
};

/**
 * The cookie value that adds the local setup, selected, to the saved ones.
 *
 * :param header: The request's Cookie header.
 * :param now: The time, as an ISO string.
 * :return: The encoded cookie value.
 */
export function withLocalSetup(header, now) {
  let saved = [];
  try {
    const part = String(header || "").split("; ").find((entry) => entry.startsWith(`${COOKIE}=`));
    const store = JSON.parse(decodeURIComponent(part.slice(COOKIE.length + 1)));
    saved = store.profiles.filter((profile) => profile?.id !== PROFILE.id);
  } catch {
    // No readable cookie: nothing to keep.
  }
  const profiles = [{ ...PROFILE, updatedAt: now }, ...saved].slice(0, MOST_PROFILES);
  let value;
  do {
    value = encodeURIComponent(JSON.stringify({ version: 1, selectedId: PROFILE.id, updatedAt: now, profiles }));
  } while (value.length > MOST_COOKIE && profiles.pop());
  return value;
}

/**
 * Answer one visit: set the cookie on this host name, then go to the next one.
 *
 * :param request: The incoming request.
 * :param response: The response to write.
 */
export function answer(request, response) {
  const at = HOSTS.findIndex((host) => request.headers.host === `${host}:${SETUP_PORT}`);
  if (at < 0 || request.method !== "GET" || request.url !== "/") {
    response.writeHead(404);
    response.end();
    return;
  }
  const next = HOSTS[at + 1];
  response.writeHead(302, {
    "Cache-Control": "no-store",
    "Set-Cookie": `${COOKIE}=${withLocalSetup(request.headers.cookie, new Date().toISOString())}; Path=/; Max-Age=15552000; SameSite=Lax`,
    Location: next ? `http://${next}:${SETUP_PORT}/` : "http://127.0.0.1:8080/",
  });
  response.end();
}

/**
 * Listen on this computer only.
 *
 * :return: The URL to open once in the browser.
 */
export function startLocalAi() {
  for (const host of ["127.0.0.1", "::1"]) {
    const server = http.createServer(answer);
    server.on("error", (error) => console.error(`[Local AI] ${error.message}`));
    server.listen(SETUP_PORT, host);
  }
  return `http://${HOSTS[0]}:${SETUP_PORT}/`;
}
