// src/config.ts
var REMOTE_WSS = "wss://game.vibistudiotest.site";
var LOCAL_PORT = 2020;
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
function from_query_param() {
  if (!has_window())
    return;
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get("ws");
    if (value) {
      return value.startsWith("ws") ? value : `wss://${value}`;
    }
  } catch {}
  return;
}
function detect_url() {
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
  return REMOTE_WSS;
}
var WS_URL = detect_url();
var DEFAULT_REMOTE_WS = REMOTE_WSS;
var DEFAULT_LOCAL_WS = `ws://localhost:${LOCAL_PORT}`;

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

// pokebomber/index.ts
var TICK_RATE = 30;
var TOLERANCE = 300;
var TILE_SIZE = 32;
var STEP_TICKS = 6;
var CANVAS_SCALE = 2;
var NOTEBOOK_WIDTH = 1366;
var NOTEBOOK_HEIGHT = 768;
var MAP_PORTION = 2 / 3;
var TARGET_WIDTH_PX = Math.floor(NOTEBOOK_WIDTH * MAP_PORTION);
var TARGET_HEIGHT_PX = Math.floor(NOTEBOOK_HEIGHT * MAP_PORTION);
function clamp_tiles(px) {
  const minimum = Math.max(6, Math.floor(px / TILE_SIZE));
  return minimum % 2 === 0 ? minimum - 1 : minimum;
}
var MAP_WIDTH = clamp_tiles(TARGET_WIDTH_PX);
var MAP_HEIGHT = clamp_tiles(TARGET_HEIGHT_PX);
var MAP_BLUEPRINT = build_blueprint(MAP_WIDTH, MAP_HEIGHT);
var MAP_HEIGHT_PX = MAP_HEIGHT * TILE_SIZE * CANVAS_SCALE;
var MAP_WIDTH_PX = MAP_WIDTH * TILE_SIZE * CANVAS_SCALE;
var INPUT_PRIORITY = ["up", "left", "down", "right"];
var DIR_VECTORS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
};
var SPAWN_POINTS = build_spawns();
function build_blueprint(width, height) {
  const rows = [];
  for (let y = 0;y < height; y++) {
    let row = "";
    for (let x = 0;x < width; x++) {
      let tile = ".";
      const border = y === 0 || y === height - 1 || x === 0 || x === width - 1;
      const pillar = !border && x % 4 === 0 && y % 3 === 0;
      tile = border || pillar ? "#" : tile;
      row += tile;
    }
    rows.push(row);
  }
  return rows;
}
function build_spawns() {
  return [
    { x: 1, y: 1 },
    { x: MAP_WIDTH - 2, y: MAP_HEIGHT - 2 },
    { x: 1, y: MAP_HEIGHT - 2 },
    { x: MAP_WIDTH - 2, y: 1 }
  ];
}
function create_player(x, y) {
  return {
    x,
    y,
    dir: "down",
    moving: false,
    progress: 0,
    startX: x,
    startY: y,
    targetX: x,
    targetY: y,
    inputs: { up: 0, down: 0, left: 0, right: 0 }
  };
}
function clone_player(player) {
  return {
    ...player,
    inputs: { ...player.inputs }
  };
}
function is_walkable(x, y) {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) {
    return false;
  }
  const tile = MAP_BLUEPRINT[y][x];
  return tile !== "#";
}
function select_direction(inputs) {
  for (const dir of INPUT_PRIORITY) {
    if (inputs[dir]) {
      return dir;
    }
  }
  return;
}
function spawn_position_for(id) {
  const idx = Math.abs(hash_string(id)) % SPAWN_POINTS.length;
  return SPAWN_POINTS[idx];
}
function hash_string(value) {
  let hash = 0;
  for (let i = 0;i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
var initial = {};
function on_tick(state) {
  const next_state = {};
  for (const [nick, player] of Object.entries(state)) {
    let updated = clone_player(player);
    if (updated.moving) {
      const remaining = updated.progress - 1;
      updated.progress = Math.max(remaining, 0);
      if (remaining <= 0) {
        updated.x = updated.targetX;
        updated.y = updated.targetY;
        updated.startX = updated.x;
        updated.startY = updated.y;
        updated.moving = false;
        updated.progress = 0;
      }
    }
    if (!updated.moving) {
      const dir = select_direction(updated.inputs);
      if (dir) {
        const { dx, dy } = DIR_VECTORS[dir];
        const nx = updated.x + dx;
        const ny = updated.y + dy;
        if (is_walkable(nx, ny)) {
          updated.dir = dir;
          updated.moving = true;
          updated.progress = STEP_TICKS;
          updated.startX = updated.x;
          updated.startY = updated.y;
          updated.targetX = nx;
          updated.targetY = ny;
        }
      }
    }
    next_state[nick] = updated;
  }
  return next_state;
}
function on_post(post2, state) {
  switch (post2.$) {
    case "spawn": {
      const player = create_player(post2.x, post2.y);
      return { ...state, [post2.nick]: player };
    }
    case "press": {
      const current = state[post2.nick];
      if (!current)
        return state;
      const updated = clone_player(current);
      updated.inputs[post2.dir] = 1;
      return { ...state, [post2.nick]: updated };
    }
    case "release": {
      const current = state[post2.nick];
      if (!current)
        return state;
      const updated = clone_player(current);
      updated.inputs[post2.dir] = 0;
      return { ...state, [post2.nick]: updated };
    }
  }
  return state;
}
function create_game(room, smooth) {
  return new Vibi(room, initial, on_tick, on_post, smooth, TICK_RATE, TOLERANCE);
}
var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");
canvas.width = MAP_WIDTH_PX;
canvas.height = MAP_HEIGHT_PX;
var overlay = get_element("setup-overlay");
var step_title = get_element("setup-title");
var step_description = get_element("setup-description");
var step_form = get_element("setup-form");
var step_input = get_element("setup-input");
var step_error = get_element("setup-error");
var room = "";
var nick = "";
var game = null;
var smooth = (past, curr) => {
  if (nick && curr[nick]) {
    past[nick] = curr[nick];
  }
  return past;
};
collect_session().then(({ room: selected_room, nick: selected_nick }) => {
  room = selected_room;
  nick = selected_nick;
  document.title = `Pokebomber ${package_default.version} - ${room}`;
  game = create_game(room, smooth);
  bind_inputs();
});
function bind_inputs() {
  if (!game)
    return;
  const KEY_TO_DIR = {
    w: "up",
    arrowup: "up",
    a: "left",
    arrowleft: "left",
    s: "down",
    arrowdown: "down",
    d: "right",
    arrowright: "right"
  };
  const key_states = {};
  on_sync(() => {
    const spawn = spawn_position_for(`${room}:${nick}`);
    console.log(`[BOMBER] Synced; spawning '${nick}' at tile (${spawn.x},${spawn.y})`);
    game.post({ $: "spawn", nick, x: spawn.x, y: spawn.y });
    function handle_key_event(e) {
      const dir = KEY_TO_DIR[e.key.toLowerCase()];
      if (!dir)
        return;
      e.preventDefault();
      const is_down = e.type === "keydown";
      if (key_states[dir] === is_down) {
        return;
      }
      key_states[dir] = is_down;
      const action = is_down ? "press" : "release";
      game.post({ $: action, dir, nick });
    }
    window.addEventListener("keydown", handle_key_event);
    window.addEventListener("keyup", handle_key_event);
    setInterval(() => render(), 1000 / TICK_RATE);
  });
}
function grid_position(player) {
  if (!player.moving) {
    return { renderX: player.x, renderY: player.y };
  }
  const progress = (STEP_TICKS - player.progress) / STEP_TICKS;
  const renderX = player.startX + (player.targetX - player.startX) * progress;
  const renderY = player.startY + (player.targetY - player.startY) * progress;
  return { renderX, renderY };
}
function tile_color(ch) {
  switch (ch) {
    case "#":
      return "#1f1e2c";
    default:
      return "#312f43";
  }
}
function render() {
  if (!game)
    return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0a0916";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0;y < MAP_HEIGHT; y++) {
    for (let x = 0;x < MAP_WIDTH; x++) {
      const tile = MAP_BLUEPRINT[y][x];
      ctx.fillStyle = tile_color(tile);
      ctx.fillRect(x * TILE_SIZE * CANVAS_SCALE, y * TILE_SIZE * CANVAS_SCALE, TILE_SIZE * CANVAS_SCALE, TILE_SIZE * CANVAS_SCALE);
    }
  }
  const state = game.compute_render_state();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${14 * CANVAS_SCALE}px monospace`;
  for (const [char, player] of Object.entries(state)) {
    const { renderX, renderY } = grid_position(player);
    const px = renderX * TILE_SIZE * CANVAS_SCALE;
    const py = renderY * TILE_SIZE * CANVAS_SCALE;
    const radius = TILE_SIZE * CANVAS_SCALE / 2 - 2;
    const centerX = px + TILE_SIZE * CANVAS_SCALE / 2;
    const centerY = py + TILE_SIZE * CANVAS_SCALE / 2;
    ctx.fillStyle = char === nick ? "#fdd663" : "#ff7b64";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1b1225";
    ctx.fillText(char, centerX, centerY + 1);
  }
  draw_hud();
}
function draw_hud() {
  if (!game)
    return;
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(12, 12, 260, 100);
  ctx.fillStyle = "#f2f2f2";
  ctx.font = `${14 * CANVAS_SCALE}px monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  try {
    const tick = game.server_tick();
    const st = game.server_time();
    const rtt = ping();
    ctx.fillText(`sala: ${room}`, 24, 22);
    ctx.fillText(`tick: ${tick}`, 24, 40);
    ctx.fillText(`tempo: ${st}`, 24, 58);
    if (isFinite(rtt)) {
      ctx.fillText(`ping: ${Math.round(rtt)} ms`, 24, 76);
    }
  } catch {}
}
function collect_session() {
  return new Promise((resolve) => {
    let step = "room";
    let room_value = "";
    const step_text = {
      room: {
        title: "Escolha a sala",
        description: "Digite o nome da sala ou deixe vazio para gerar um código.",
        placeholder: "sala"
      },
      nick: {
        title: "Seu apelido",
        description: "Use apenas um caractere (ex: A, *, 7).",
        placeholder: "letra única"
      }
    };
    function render_step() {
      const config = step_text[step];
      step_title.textContent = config.title;
      step_description.textContent = config.description;
      step_input.placeholder = config.placeholder;
      step_input.value = "";
      step_input.focus();
      step_error.textContent = "";
    }
    overlay.classList.add("visible");
    render_step();
    const handler = (event) => {
      event.preventDefault();
      const value = step_input.value.trim();
      step_error.textContent = "";
      if (step === "room") {
        room_value = value || gen_name();
        step = "nick";
        render_step();
        return;
      }
      if (!value || value.length !== 1) {
        step_error.textContent = "Digite apenas 1 caractere.";
        step_input.focus();
        return;
      }
      overlay.classList.remove("visible");
      overlay.classList.add("hidden");
      step_form.removeEventListener("submit", handler);
      resolve({ room: room_value, nick: value });
    };
    step_form.addEventListener("submit", handler);
  });
}
function get_element(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el;
}
export {
  create_game
};
