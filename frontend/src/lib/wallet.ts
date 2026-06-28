/**
 * Freighter wallet integration via `@stellar/freighter-api`.
 *
 * The package is the supported way to talk to Freighter v5+. It internally
 * uses `window.postMessage` to communicate with the extension's content
 * script (which in turn talks to the background service worker). Older
 * Freighter builds injected `window.freighter` directly — that no longer
 * happens in v5.x, which is why direct `window.freighter` checks fail.
 *
 * Persistence: the connected public key is stored in `localStorage` so the
 * user does not have to reconnect on every page reload. The actual signing
 * always goes through Freighter — we never see or store private keys.
 *
 * SSR note: `@stellar/freighter-api` is a CommonJS module. When Vite's SSR
 * pass tries to statically resolve named exports from it, it fails with
 * `SyntaxError: Named export 'signTransaction' not found`. We avoid that
 * by lazy-loading the module inside each function (`import("@stellar/...")`)
 * so the SSR pass never touches the CJS internals.
 */

type FreighterApi = typeof import("@stellar/freighter-api");

let freighterPromise: Promise<FreighterApi | null> | null = null;

/** Lazily load the Freighter SDK. Returns null in SSR / non-browser envs. */
function loadFreighter(): Promise<FreighterApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!freighterPromise) {
    freighterPromise = import("@stellar/freighter-api")
      .then((m) => m as unknown as FreighterApi)
      .catch(() => null);
  }
  return freighterPromise;
}

const STORAGE_KEY = "zuno:wallet:publicKey";

/**
 * Returns true if Freighter is installed and responding.
 *
 * `isConnected()` from `@stellar/freighter-api` returns
 * `{ isConnected: boolean, error?: ... }` — `isConnected: true` means the
 * extension's content script answered. (The error path returns
 * `{ isConnected: false, error: ... }` when the extension is absent.)
 */
export async function isFreighterInstalled(): Promise<boolean> {
  const api = await loadFreighter();
  if (!api) return false;
  try {
    const res = await api.isConnected();
    return !!res?.isConnected;
  } catch {
    return false;
  }
}

/**
 * Poll `isConnected()` for up to `timeoutMs` (default 1500ms) waiting for
 * the extension's content script to respond. Chrome extension content
 * scripts inject after the page's main JS, so a synchronous check at
 * first render always returns false even when Freighter IS installed.
 */
export async function waitForFreighter(timeoutMs = 1500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isFreighterInstalled()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/** Read the previously connected public key from storage (synchronous). */
export function getStoredPublicKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

/** Persist the connected public key. */
function storePublicKey(publicKey: string): void {
  window.localStorage.setItem(STORAGE_KEY, publicKey);
}

/** Clear the stored public key. */
function clearStoredPublicKey(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Prompt Freighter for access and return the connected public key.
 * Throws if Freighter is not installed, the site is not allowed, or the
 * user rejects the request.
 */
export async function connectWallet(): Promise<string> {
  const api = await loadFreighter();
  if (!api) {
    throw new Error(
      "Freighter wallet not detected. Install it from https://freighter.app to play Zuno.",
    );
  }
  const installed = await isFreighterInstalled();
  if (!installed) {
    throw new Error(
      "Freighter wallet not detected. Install it from https://freighter.app to play Zuno.",
    );
  }
  // `requestAccess` both prompts the user for permission AND returns the
  // connected address in one round-trip.
  const res = await api.requestAccess();
  if (res.error) {
    throw new Error(`Freighter requestAccess failed: ${res.error.message ?? res.error}`);
  }
  const publicKey = res.address;
  if (!publicKey || typeof publicKey !== "string") {
    throw new Error("Freighter returned an invalid public key");
  }
  storePublicKey(publicKey);
  return publicKey;
}

/**
 * Sign a transaction envelope (base64 XDR) via Freighter.
 * Returns the signed XDR (also base64).
 */
export async function signTransaction(xdr: string): Promise<string> {
  const api = await loadFreighter();
  if (!api) {
    throw new Error("Freighter wallet not available — cannot sign transaction");
  }
  const installed = await isFreighterInstalled();
  if (!installed) {
    throw new Error("Freighter wallet not available — cannot sign transaction");
  }
  const networkPassphrase =
    import.meta.env.VITE_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
  const res = await api.signTransaction(xdr, { networkPassphrase });
  if (res.error) {
    throw new Error(`Freighter signTransaction failed: ${res.error.message ?? res.error}`);
  }
  return res.signedTxXdr;
}

/**
 * Return the public key of the currently connected Freighter account,
 * or null if Freighter has not been authorised yet.
 *
 * Safe to call repeatedly; does NOT prompt the user (uses `getAddress`,
 * not `requestAccess`).
 */
export async function getConnectedWallet(): Promise<string | null> {
  const api = await loadFreighter();
  if (!api) return null;
  const installed = await isFreighterInstalled();
  if (!installed) return null;
  try {
    // Ensure the site has been allowed at least once. If not, treat as
    // "not connected" rather than prompting the user silently.
    const allowed = await api.isAllowed();
    if (allowed.error || !allowed.isAllowed) return null;

    const res = await api.getAddress();
    if (res.error || !res.address) return null;
    return res.address;
  } catch {
    return null;
  }
}

/** Forget the locally stored public key. Does not revoke Freighter access. */
export function disconnectWallet(): void {
  clearStoredPublicKey();
}