import { WS_URL } from "./config";

type TimeSync = {
  clock_offset: number;
  lowest_ping: number;
  request_sent_at: number;
  last_ping: number;
};

type InfoTime = { $: "info_time"; time: number };
type InfoPost = {
  $: "info_post";
  room: string;
  index: number;
  server_time: number;
  client_time: number;
  name?: string;
  data: any;
};

type ServerMessage = InfoTime | InfoPost;
type RoomHandler = (post: InfoPost) => void;

type SyncCallback = () => void;

const time_sync: TimeSync = {
  clock_offset: Infinity,
  lowest_ping: Infinity,
  request_sent_at: 0,
  last_ping: Infinity,
};

const ws = new WebSocket(WS_URL);
const room_watchers = new Map<string, RoomHandler>();
let is_synced = false;
const sync_listeners: SyncCallback[] = [];

function now(): number {
  return Math.floor(Date.now());
}

export function server_time(): number {
  if (!isFinite(time_sync.clock_offset)) {
    throw new Error("server_time() called before initial sync");
  }
  return Math.floor(now() + time_sync.clock_offset);
}

function ensure_open() {
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket not open");
  }
}

function send(obj: any) {
  ensure_open();
  ws.send(JSON.stringify(obj));
}

function register_handler(room: string, handler?: RoomHandler) {
  if (!handler) return;
  if (room_watchers.has(room)) {
    throw new Error(`Handler already registered for room: ${room}`);
  }
  room_watchers.set(room, handler);
}

ws.addEventListener("open", () => {
  console.log(`[WS] Connected to ${WS_URL}`);
  request_time_sync();
  setInterval(request_time_sync, 2000);
});

function request_time_sync() {
  time_sync.request_sent_at = now();
  ws.send(JSON.stringify({ $: "get_time" }));
}

ws.addEventListener("message", (event: MessageEvent<string>) => {
  const msg: ServerMessage = JSON.parse(event.data);
  switch (msg.$) {
    case "info_time":
      handle_info_time(msg);
      break;
    case "info_post":
      handle_info_post(msg);
      break;
  }
});

function handle_info_time(msg: InfoTime) {
  const t = now();
  const ping = t - time_sync.request_sent_at;
  time_sync.last_ping = ping;

  if (ping < time_sync.lowest_ping) {
    const local_avg = Math.floor((time_sync.request_sent_at + t) / 2);
    time_sync.clock_offset = msg.time - local_avg;
    time_sync.lowest_ping = ping;
  }

  if (!is_synced) {
    is_synced = true;
    for (const cb of sync_listeners) {
      cb();
    }
    sync_listeners.length = 0;
  }
}

function handle_info_post(msg: InfoPost) {
  const handler = room_watchers.get(msg.room);
  if (handler) {
    handler(msg);
  }
}

export function gen_name(): string {
  const alphabet = "_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
  const bytes = new Uint8Array(8);
  const can_crypto = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";

  if (can_crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % 64];
  }
  return out;
}

export function post(room: string, data: any): string {
  const name = gen_name();
  send({ $: "post", room, time: server_time(), name, data });
  return name;
}

export function load(room: string, from = 0, handler?: RoomHandler) {
  register_handler(room, handler);
  send({ $: "load", room, from });
}

export function watch(room: string, handler?: RoomHandler) {
  register_handler(room, handler);
  send({ $: "watch", room });
}

export function on_sync(callback: SyncCallback) {
  if (is_synced) {
    callback();
    return;
  }
  sync_listeners.push(callback);
}

export function ping(): number {
  return time_sync.last_ping;
}
