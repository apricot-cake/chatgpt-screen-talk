const storageKey = "screen-talk-access-token";
const fragment = new URLSearchParams(window.location.hash.slice(1));
const supplied = fragment.get("token");
if (fragment.has("token")) {
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  window.sessionStorage.removeItem(storageKey);
  if (supplied && /^[\w-]{43}$/.test(supplied))
    window.sessionStorage.setItem(storageKey, supplied);
}
const token = window.sessionStorage.getItem(storageKey);

export async function apiFetch(input: string | URL, init: RequestInit = {}) {
  const url = new URL(input, window.location.origin);
  if (url.origin !== window.location.origin)
    throw new Error("接続先が正しくありません。");
  if (!token)
    throw new Error("起動時に表示されたURLからアプリを開いてください。");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, {
    ...init,
    headers,
    credentials: "omit",
    redirect: "error",
  });
}
