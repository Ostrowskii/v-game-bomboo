// src/config.ts
var REMOTE_WSS = "wss://game.vibistudiotest.site";
function has_window() {
  return typeof window !== "undefined" && typeof window.location !== "undefined";
}
function from_global_override() {
  if (!has_window())
    return;
  const global_any = window;
  if (typeof global_any.__VIBI_WS_URL__ === "string") {
    return global_any.__VIBI_WS_URL__;
  }
  return;
}
function normalize(value) {
  if (value.startsWith("wss://")) {
    return value;
  }
  if (value.startsWith("ws://")) {
    return `wss://${value.slice("ws://".length)}`;
  }
  return `wss://${value}`;
}
function from_query_param() {
  if (!has_window())
    return;
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get("ws");
    if (value) {
      return normalize(value);
    }
  } catch {}
  return;
}
function detect_url() {
  const manual = from_global_override() ?? from_query_param();
  if (manual) {
    return manual;
  }
  return REMOTE_WSS;
}
var WS_URL = detect_url();

// src/client.ts
var time_sync = {
  clock_offset: Infinity,
  lowest_ping: Infinity,
  request_sent_at: 0,
  last_ping: Infinity
};
var ws = new WebSocket(WS_URL);
var room_watchers = new Map;
var is_synced = false;
var sync_listeners = [];
function now() {
  return Math.floor(Date.now());
}
function server_time() {
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
function send(obj) {
  ensure_open();
  ws.send(JSON.stringify(obj));
}
function register_handler(room, handler) {
  if (!handler)
    return;
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
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.$) {
    case "info_time":
      handle_info_time(msg);
      break;
    case "info_post":
      handle_info_post(msg);
      break;
  }
});
function handle_info_time(msg) {
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
function handle_info_post(msg) {
  const handler = room_watchers.get(msg.room);
  if (handler) {
    handler(msg);
  }
}
function gen_name() {
  const alphabet = "_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
  const bytes = new Uint8Array(8);
  const can_crypto = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";
  if (can_crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0;i < 8; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0;i < 8; i++) {
    out += alphabet[bytes[i] % 64];
  }
  return out;
}
function post(room, data) {
  const name = gen_name();
  send({ $: "post", room, time: server_time(), name, data });
  return name;
}
function load(room, from = 0, handler) {
  register_handler(room, handler);
  send({ $: "load", room, from });
}
function watch(room, handler) {
  register_handler(room, handler);
  send({ $: "watch", room });
}
function on_sync(callback) {
  if (is_synced) {
    callback();
    return;
  }
  sync_listeners.push(callback);
}
function ping() {
  return time_sync.last_ping;
}

// src/vibi.ts
class Vibi {
  room;
  init;
  on_tick;
  on_post;
  smooth;
  tick_rate;
  tolerance;
  room_posts = new Map;
  local_posts = new Map;
  constructor(room, init, on_tick, on_post, smooth, tick_rate, tolerance) {
    this.room = room;
    this.init = init;
    this.on_tick = on_tick;
    this.on_post = on_post;
    this.smooth = smooth;
    this.tick_rate = tick_rate;
    this.tolerance = tolerance;
    on_sync(() => {
      console.log(`[VIBI] synced; watching+loading room=${this.room}`);
      watch(this.room, (post2) => {
        if (post2.name && this.local_posts.has(post2.name)) {
          this.local_posts.delete(post2.name);
        }
        this.room_posts.set(post2.index, post2);
      });
      load(this.room, 0);
    });
  }
  time_to_tick(server_time2) {
    return Math.floor(server_time2 * this.tick_rate / 1000);
  }
  server_time() {
    return server_time();
  }
  server_tick() {
    return this.time_to_tick(this.server_time());
  }
  post_count() {
    return this.room_posts.size;
  }
  official_time(post2) {
    if (post2.client_time <= post2.server_time - this.tolerance) {
      return post2.server_time - this.tolerance;
    }
    return post2.client_time;
  }
  official_tick(post2) {
    return this.time_to_tick(this.official_time(post2));
  }
  initial_time() {
    const first = this.room_posts.get(0);
    return first ? this.official_time(first) : null;
  }
  initial_tick() {
    const t = this.initial_time();
    return t === null ? null : this.time_to_tick(t);
  }
  compute_state_at(at_tick) {
    const starting_tick = this.initial_tick();
    if (starting_tick === null || at_tick < starting_tick) {
      return this.init;
    }
    const timeline = new Map;
    const push_post = (post2) => {
      const tick = this.official_tick(post2);
      if (!timeline.has(tick)) {
        timeline.set(tick, []);
      }
      timeline.get(tick).push(post2);
    };
    for (const post2 of this.room_posts.values()) {
      push_post(post2);
    }
    for (const post2 of this.local_posts.values()) {
      const queued = { ...post2, index: Number.MAX_SAFE_INTEGER };
      push_post(queued);
    }
    for (const posts of timeline.values()) {
      posts.sort((a, b) => a.index - b.index);
    }
    let state = this.init;
    for (let tick = starting_tick;tick <= at_tick; tick++) {
      state = this.on_tick(state);
      const posts = timeline.get(tick) || [];
      for (const post2 of posts) {
        state = this.on_post(post2.data, state);
      }
    }
    return state;
  }
  compute_render_state() {
    const curr_tick = this.server_tick();
    const tick_ms = 1000 / this.tick_rate;
    const tol_ticks = Math.ceil(this.tolerance / tick_ms);
    const rtt_ms = ping();
    const half_rtt = isFinite(rtt_ms) ? Math.ceil(rtt_ms / 2 / tick_ms) : 0;
    const past_ticks = Math.max(tol_ticks, half_rtt + 1);
    const past_tick = Math.max(0, curr_tick - past_ticks);
    const past_state = this.compute_state_at(past_tick);
    const curr_state = this.compute_state_at(curr_tick);
    return this.smooth(past_state, curr_state);
  }
  compute_current_state() {
    return this.compute_state_at(this.server_tick());
  }
  post(data) {
    const name = post(this.room, data);
    const t = this.server_time();
    const local_post = {
      room: this.room,
      index: -1,
      server_time: t,
      client_time: t,
      name,
      data
    };
    this.local_posts.set(name, local_post);
  }
}
// package.json
var package_default = {
  name: "pokebomber",
  version: "0.1.0",
  type: "module",
  scripts: {
    build: "bun run build:pokebomber && bun run build:snake",
    "build:pokebomber": "bun build pokebomber/index.ts --outdir pokebomber/dist --target browser --format esm",
    "build:snake": "bun build snake/index.ts --outdir snake/dist --target browser --format esm"
  }
};

// snake/index.ts
var CELL_SIZE = 20;
var GRID_COLS = 32;
var GRID_ROWS = 18;
var MAP_WIDTH = GRID_COLS * CELL_SIZE;
var MAP_HEIGHT = GRID_ROWS * CELL_SIZE;
var INITIAL_LENGTH = 5;
var BORDER_OFFSET = 1;
var TICK_RATE = 10;
var TOLERANCE = 250;
var initial = {};
var DIR_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};
function is_opposite(a, b) {
  return a === "up" && b === "down" || a === "down" && b === "up" || a === "left" && b === "right" || a === "right" && b === "left";
}
function tint_for(nick) {
  const palette = ["#4af2a1", "#ffb347", "#64b5f6", "#f67280", "#ffd166", "#c3a3ff", "#55efc4"];
  const code = nick.codePointAt(0) ?? 0;
  return palette[code % palette.length];
}
function clone_segments(body) {
  return body.map((segment) => ({ ...segment }));
}
function segment_key(segment) {
  return `${segment.x}:${segment.y}`;
}
function on_tick(state) {
  const updated = {};
  const body_cache = new Map;
  for (const [nick, snake] of Object.entries(state)) {
    if (!snake)
      continue;
    const cloned = {
      ...snake,
      body: clone_segments(snake.body)
    };
    if (!snake.alive) {
      updated[nick] = cloned;
      body_cache.set(nick, new Set(cloned.body.map(segment_key)));
      continue;
    }
    const dir = snake.pending ?? snake.dir;
    const head = cloned.body[0];
    const move = DIR_VECTORS[dir];
    const next_head = { x: head.x + move.x, y: head.y + move.y };
    const hit_wall = next_head.x < 0 || next_head.x >= GRID_COLS || next_head.y < 0 || next_head.y >= GRID_ROWS;
    if (hit_wall) {
      cloned.alive = false;
      cloned.dir = dir;
      cloned.pending = dir;
      updated[nick] = cloned;
      body_cache.set(nick, new Set(cloned.body.map(segment_key)));
      continue;
    }
    cloned.body.unshift(next_head);
    const collision_index = cloned.body.findIndex((segment, index) => index !== 0 && segment.x === next_head.x && segment.y === next_head.y);
    if (collision_index !== -1) {
      cloned.body = cloned.body.slice(0, collision_index);
      cloned.length = Math.max(1, cloned.body.length);
    } else {
      while (cloned.body.length > cloned.length) {
        cloned.body.pop();
      }
    }
    cloned.dir = dir;
    cloned.pending = dir;
    updated[nick] = cloned;
    body_cache.set(nick, new Set(cloned.body.map(segment_key)));
  }
  for (const [nick, snake] of Object.entries(updated)) {
    if (!snake?.alive)
      continue;
    const head = snake.body[0];
    if (!head)
      continue;
    const head_key = segment_key(head);
    for (const [other_nick, set] of body_cache.entries()) {
      if (other_nick === nick)
        continue;
      const other_snake = updated[other_nick];
      if (!other_snake?.alive)
        continue;
      if (set.has(head_key)) {
        snake.alive = false;
        break;
      }
    }
  }
  return updated;
}
function on_post(post2, state) {
  switch (post2.$) {
    case "spawn": {
      const dir = post2.dir;
      const head_x = clamp(post2.x, INITIAL_LENGTH + BORDER_OFFSET, GRID_COLS - BORDER_OFFSET - 1);
      const head_y = clamp(post2.y, BORDER_OFFSET, GRID_ROWS - BORDER_OFFSET - 1);
      const body = [];
      for (let i = 0;i < INITIAL_LENGTH; i++) {
        body.push({ x: head_x - i, y: head_y });
      }
      const snake = {
        body,
        dir,
        pending: dir,
        alive: true,
        color: tint_for(post2.nick),
        length: INITIAL_LENGTH
      };
      return { ...state, [post2.nick]: snake };
    }
    case "turn": {
      const snake = state[post2.nick];
      if (!snake || !snake.alive) {
        return state;
      }
      const current = snake.pending ?? snake.dir;
      if (current === post2.dir || is_opposite(current, post2.dir)) {
        return state;
      }
      const updated = { ...snake, pending: post2.dir };
      return { ...state, [post2.nick]: updated };
    }
  }
  return state;
}
function create_game(room, smooth) {
  return new Vibi(room, initial, on_tick, on_post, smooth, TICK_RATE, TOLERANCE);
}
var canvas = document.getElementById("snake");
var ctx = canvas.getContext("2d");
canvas.width = MAP_WIDTH;
canvas.height = MAP_HEIGHT;
document.title = `Snake Rooms ${package_default.version}`;
var room_input = prompt("Sala (deixe vazio para gerar):") ?? "";
var room = room_input.trim();
if (!room) {
  room = gen_name();
}
var room_id = `snake:${room}`;
var nick_input = prompt("Apelido (1-3 letras):") ?? "";
var nick = (nick_input.trim().slice(0, 3) || "SSS").toUpperCase();
console.log("[SNAKE] Room:", room, "(id:", room_id, ") Nick:", nick);
var smooth = (past, curr) => {
  if (curr[nick]) {
    past[nick] = curr[nick];
  }
  return past;
};
var game = create_game(room_id, smooth);
var key_map = {
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right"
};
var direction_counts = { up: 0, down: 0, left: 0, right: 0 };
var pressed_keys = new Set;
var direction_stack = [];
var desired_direction = null;
var awaiting_turn = false;
var pending_direction = null;
var last_known_direction = "right";
var player_alive = false;
function update_desired_direction() {
  desired_direction = direction_stack.length ? direction_stack[direction_stack.length - 1] : null;
}
function try_send_turn() {
  if (!player_alive)
    return;
  if (awaiting_turn)
    return;
  if (!desired_direction)
    return;
  const target = desired_direction;
  if (target === last_known_direction)
    return;
  if (is_opposite(last_known_direction, target))
    return;
  game.post({ $: "turn", nick, dir: target });
  awaiting_turn = true;
  pending_direction = target;
}
function remember_direction(dir) {
  if (direction_counts[dir] === 0) {
    const idx = direction_stack.indexOf(dir);
    if (idx !== -1)
      direction_stack.splice(idx, 1);
    direction_stack.push(dir);
    update_desired_direction();
  }
  direction_counts[dir]++;
  try_send_turn();
}
function release_direction(dir) {
  if (direction_counts[dir] === 0) {
    return;
  }
  direction_counts[dir] = Math.max(0, direction_counts[dir] - 1);
  if (direction_counts[dir] === 0) {
    const idx = direction_stack.indexOf(dir);
    if (idx !== -1)
      direction_stack.splice(idx, 1);
    update_desired_direction();
    try_send_turn();
  }
}
function random_spawn_position() {
  const max_x = GRID_COLS - BORDER_OFFSET - 1;
  const min_x = INITIAL_LENGTH + BORDER_OFFSET;
  const max_y = GRID_ROWS - BORDER_OFFSET - 1;
  const min_y = BORDER_OFFSET;
  const x = Math.floor(Math.random() * (max_x - min_x + 1)) + min_x;
  const y = Math.floor(Math.random() * (max_y - min_y + 1)) + min_y;
  return { x, y };
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function spawn_self() {
  const { x, y } = random_spawn_position();
  game.post({ $: "spawn", nick, x, y, dir: "right" });
  awaiting_turn = false;
  pending_direction = null;
  last_known_direction = "right";
  player_alive = true;
}
on_sync(() => {
  console.log("[SNAKE] Synced, spawning player");
  spawn_self();
  function handle_keydown(event) {
    const key = event.key.toLowerCase();
    if (key === "r") {
      spawn_self();
      return;
    }
    const dir = key_map[key];
    if (!dir || pressed_keys.has(key)) {
      return;
    }
    pressed_keys.add(key);
    remember_direction(dir);
  }
  function handle_keyup(event) {
    const key = event.key.toLowerCase();
    if (!pressed_keys.has(key)) {
      return;
    }
    pressed_keys.delete(key);
    const dir = key_map[key];
    if (dir) {
      release_direction(dir);
    }
  }
  window.addEventListener("keydown", handle_keydown);
  window.addEventListener("keyup", handle_keyup);
  setInterval(render, 1000 / 30);
});
function draw_grid() {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let x = CELL_SIZE;x < MAP_WIDTH; x += CELL_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MAP_HEIGHT);
    ctx.stroke();
  }
  for (let y = CELL_SIZE;y < MAP_HEIGHT; y += CELL_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(MAP_WIDTH, y);
    ctx.stroke();
  }
}
function render() {
  ctx.fillStyle = "#0c0e16";
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  draw_grid();
  ctx.strokeStyle = "#4af2a1";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, MAP_WIDTH - 4, MAP_HEIGHT - 4);
  const state = game.compute_render_state();
  const tick = game.server_tick();
  const my_snake = state[nick];
  if (my_snake) {
    player_alive = !!my_snake.alive;
    if (my_snake.dir && my_snake.dir !== last_known_direction) {
      last_known_direction = my_snake.dir;
    }
    if (!player_alive) {
      awaiting_turn = false;
      pending_direction = null;
    } else if (awaiting_turn && pending_direction && my_snake.dir === pending_direction) {
      awaiting_turn = false;
      pending_direction = null;
      try_send_turn();
    }
  } else {
    player_alive = false;
    awaiting_turn = false;
    pending_direction = null;
  }
  for (const [player, snake] of Object.entries(state)) {
    ctx.fillStyle = snake.color;
    ctx.globalAlpha = snake.alive ? 1 : 0.4;
    snake.body.forEach((segment, index) => {
      const x = segment.x * CELL_SIZE;
      const y = segment.y * CELL_SIZE;
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
      if (index === 0) {
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      }
    });
    ctx.globalAlpha = 1;
    const label_x = snake.body[0]?.x ?? 0;
    const label_y = snake.body[0]?.y ?? 0;
    ctx.fillStyle = "#fff";
    ctx.font = "12px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(player, label_x * CELL_SIZE + CELL_SIZE / 2, label_y * CELL_SIZE - 2);
  }
  ctx.fillStyle = "#f8f8f2";
  ctx.font = "14px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`sala: ${room}`, 8, 8);
  ctx.fillText(`tick: ${tick}`, 8, 28);
  const latency = ping();
  if (isFinite(latency)) {
    ctx.fillText(`ping: ${Math.round(latency)} ms`, 8, 48);
  }
  ctx.fillText(my_snake?.alive ? "status: vivo" : "status: fora (R para respawn)", 8, 68);
}
export {
  create_game
};
