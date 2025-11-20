import { Vibi } from "../src/vibi.ts";
import { on_sync, ping, gen_name } from "../src/client.ts";
import pkg from "../package.json" assert { type: "json" };

type Direction = "up" | "down" | "left" | "right";

type Segment = {
  x: number;
  y: number;
};

type SnakePlayer = {
  body: Segment[];
  dir: Direction;
  pending: Direction;
  alive: boolean;
  color: string;
  length: number;
};

type GameState = Record<string, SnakePlayer>;

type GamePost =
  | { $: "spawn"; nick: string; x: number; y: number; dir: Direction }
  | { $: "turn"; nick: string; dir: Direction };

const CELL_SIZE = 20;
const GRID_COLS = 32;
const GRID_ROWS = 18;
const MAP_WIDTH = GRID_COLS * CELL_SIZE;   // 640px ~ 50% of 1280px width
const MAP_HEIGHT = GRID_ROWS * CELL_SIZE;  // 360px ~ 50% of 720px height
const INITIAL_LENGTH = 5;
const BORDER_OFFSET = 1; // keep players away from the wall when spawning

const TICK_RATE = 10;
const TOLERANCE = 250;

const initial: GameState = {};

const DIR_VECTORS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function is_opposite(a: Direction, b: Direction): boolean {
  return (
    (a === "up" && b === "down") ||
    (a === "down" && b === "up") ||
    (a === "left" && b === "right") ||
    (a === "right" && b === "left")
  );
}

function tint_for(nick: string): string {
  const palette = ["#4af2a1", "#ffb347", "#64b5f6", "#f67280", "#ffd166", "#c3a3ff", "#55efc4"];
  const code = nick.codePointAt(0) ?? 0;
  return palette[code % palette.length];
}

function clone_segments(body: Segment[]): Segment[] {
  return body.map((segment) => ({ ...segment }));
}

function segment_key(segment: Segment): string {
  return `${segment.x}:${segment.y}`;
}

function on_tick(state: GameState): GameState {
  const updated: GameState = {};
  const body_cache = new Map<string, Set<string>>();

  for (const [nick, snake] of Object.entries(state)) {
    if (!snake) continue;
    const cloned: SnakePlayer = {
      ...snake,
      body: clone_segments(snake.body),
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
    const hit_wall =
      next_head.x < 0 || next_head.x >= GRID_COLS || next_head.y < 0 || next_head.y >= GRID_ROWS;

    if (hit_wall) {
      cloned.alive = false;
      cloned.dir = dir;
      cloned.pending = dir;
      updated[nick] = cloned;
      body_cache.set(nick, new Set(cloned.body.map(segment_key)));
      continue;
    }

    cloned.body.unshift(next_head);

    const collision_index = cloned.body.findIndex(
      (segment, index) =>
        index !== 0 && segment.x === next_head.x && segment.y === next_head.y,
    );

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
    if (!snake?.alive) continue;
    const head = snake.body[0];
    if (!head) continue;
    const head_key = segment_key(head);

    for (const [other_nick, set] of body_cache.entries()) {
      if (other_nick === nick) continue;
      const other_snake = updated[other_nick];
      if (!other_snake?.alive) continue;

      if (set.has(head_key)) {
        snake.alive = false;
        break;
      }
    }
  }

  return updated;
}

function on_post(post: GamePost, state: GameState): GameState {
  switch (post.$) {
    case "spawn": {
      const dir = post.dir;
      const head_x = clamp(
        post.x,
        INITIAL_LENGTH + BORDER_OFFSET,
        GRID_COLS - BORDER_OFFSET - 1,
      );
      const head_y = clamp(post.y, BORDER_OFFSET, GRID_ROWS - BORDER_OFFSET - 1);
      const body: Segment[] = [];
      for (let i = 0; i < INITIAL_LENGTH; i++) {
        body.push({ x: head_x - i, y: head_y });
      }

      const snake: SnakePlayer = {
        body,
        dir,
        pending: dir,
        alive: true,
        color: tint_for(post.nick),
        length: INITIAL_LENGTH,
      };
      return { ...state, [post.nick]: snake };
    }
    case "turn": {
      const snake = state[post.nick];
      if (!snake || !snake.alive) {
        return state;
      }

      const current = snake.pending ?? snake.dir;
      if (current === post.dir || is_opposite(current, post.dir)) {
        return state;
      }

      const updated = { ...snake, pending: post.dir };
      return { ...state, [post.nick]: updated };
    }
  }
  return state;
}

export function create_game(
  room: string,
  smooth: (past: GameState, curr: GameState) => GameState,
) {
  return new Vibi<GameState, GamePost>(room, initial, on_tick, on_post, smooth, TICK_RATE, TOLERANCE);
}

const canvas = document.getElementById("snake") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
canvas.width = MAP_WIDTH;
canvas.height = MAP_HEIGHT;

document.title = `Snake Rooms ${pkg.version}`;

const room_input = prompt("Sala (deixe vazio para gerar):") ?? "";
let room = room_input.trim();
if (!room) {
  room = gen_name();
}
const room_id = `snake:${room}`;

const nick_input = prompt("Apelido (1-3 letras):") ?? "";
const nick = (nick_input.trim().slice(0, 3) || "SSS").toUpperCase();

console.log("[SNAKE] Room:", room, "(id:", room_id, ") Nick:", nick);

const smooth = (past: GameState, curr: GameState): GameState => {
  if (curr[nick]) {
    past[nick] = curr[nick];
  }
  return past;
};

const game: Vibi<GameState, GamePost> = create_game(room_id, smooth);

const key_map: Record<string, Direction> = {
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
};

type DirectionCounts = Record<Direction, number>;
const direction_counts: DirectionCounts = { up: 0, down: 0, left: 0, right: 0 };
const pressed_keys = new Set<string>();
const direction_stack: Direction[] = [];
let desired_direction: Direction | null = null;
let awaiting_turn = false;
let pending_direction: Direction | null = null;
let last_known_direction: Direction = "right";
let player_alive = false;

function update_desired_direction() {
  desired_direction = direction_stack.length
    ? direction_stack[direction_stack.length - 1]
    : null;
}

function try_send_turn() {
  if (!player_alive) return;
  if (awaiting_turn) return;
  if (!desired_direction) return;

  const target = desired_direction;
  if (target === last_known_direction) return;
  if (is_opposite(last_known_direction, target)) return;

  game.post({ $: "turn", nick, dir: target });
  awaiting_turn = true;
  pending_direction = target;
}

function remember_direction(dir: Direction) {
  if (direction_counts[dir] === 0) {
    const idx = direction_stack.indexOf(dir);
    if (idx !== -1) direction_stack.splice(idx, 1);
    direction_stack.push(dir);
    update_desired_direction();
  }
  direction_counts[dir]++;
  try_send_turn();
}

function release_direction(dir: Direction) {
  if (direction_counts[dir] === 0) {
    return;
  }
  direction_counts[dir] = Math.max(0, direction_counts[dir] - 1);
  if (direction_counts[dir] === 0) {
    const idx = direction_stack.indexOf(dir);
    if (idx !== -1) direction_stack.splice(idx, 1);
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

function clamp(value: number, min: number, max: number): number {
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

  function handle_keydown(event: KeyboardEvent) {
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

  function handle_keyup(event: KeyboardEvent) {
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
  for (let x = CELL_SIZE; x < MAP_WIDTH; x += CELL_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MAP_HEIGHT);
    ctx.stroke();
  }
  for (let y = CELL_SIZE; y < MAP_HEIGHT; y += CELL_SIZE) {
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

  ctx.fillText(
    my_snake?.alive ? "status: vivo" : "status: fora (R para respawn)",
    8,
    68,
  );
}
