const REMOTE_HOST = "18.228.172.111";
const REMOTE_PORT = 8080;
const LOCAL_PORT  = 2020;

function has_window(): boolean {
  return typeof window !== "undefined" && typeof window.location !== "undefined";
}

function from_global_override(): string | undefined {
  if (!has_window()) return undefined;
  const global_any = window as typeof window & { __VIBI_WS_URL__?: string };
  if (typeof global_any.__VIBI_WS_URL__ === "string") {
    return global_any.__VIBI_WS_URL__;
  }
  return undefined;
}

function from_query_param(): string | undefined {
  if (!has_window()) return undefined;
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get("ws");
    if (value) {
      return value.startsWith("ws") ? value : `ws://${value}`;
    }
  } catch {}
  return undefined;
}

function detect_url(): string {
  const manual = from_global_override() ?? from_query_param();
  if (manual) {
    return manual;
  }

  if (has_window()) {
    const host = window.location.hostname;
    const is_local = host === "localhost" || host === "127.0.0.1";
    if (is_local) {
      return `ws://${host}:${LOCAL_PORT}`;
    }
  }

  return `ws://${REMOTE_HOST}:${REMOTE_PORT}`;
}

export const WS_URL = detect_url();
export const DEFAULT_REMOTE_WS = `ws://${REMOTE_HOST}:${REMOTE_PORT}`;
export const DEFAULT_LOCAL_WS  = `ws://localhost:${LOCAL_PORT}`;
