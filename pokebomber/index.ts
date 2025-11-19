import { Vibi } from "../src/vibi.ts";
import { on_sync, ping, gen_name } from "../src/client.ts";
import pkg from "../package.json" assert { type: "json" };

type Direction = "up" | "down" | "left" | "right";

type InputState = {
  up: 0 | 1;
  down: 0 | 1;
  left: 0 | 1;
  right: 0 | 1;
};

type BomberPlayer = {
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  progress: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  inputs: InputState;
};

type GameState = {
  [char: string]: BomberPlayer;
};

type GamePost =
  | { $: "spawn"; nick: string; x: number; y: number }
  | { $: "press"; dir: Direction; nick: string }
  | { $: "release"; dir: Direction; nick: string };

type SetupStep = "room" | "nick";

const TICK_RATE         = 30;
const TOLERANCE         = 300;
const TILE_SIZE         = 32;
const STEP_TICKS        = 6;
const CANVAS_SCALE      = 2;
const NOTEBOOK_WIDTH    = 1366;
const NOTEBOOK_HEIGHT   = 768;
const MAP_PORTION       = 2 / 3; // mapa ocupa 2/3 da largura/altura típicas

const TARGET_WIDTH_PX  = Math.floor(NOTEBOOK_WIDTH * MAP_PORTION);
const TARGET_HEIGHT_PX = Math.floor(NOTEBOOK_HEIGHT * MAP_PORTION);

function clamp_tiles(px: number): number {
  const minimum = Math.max(6, Math.floor(px / TILE_SIZE));
  return minimum % 2 === 0 ? minimum - 1 : minimum;
}

const MAP_WIDTH  = clamp_tiles(TARGET_WIDTH_PX);
const MAP_HEIGHT = clamp_tiles(TARGET_HEIGHT_PX);

const MAP_BLUEPRINT = build_blueprint(MAP_WIDTH, MAP_HEIGHT);
const MAP_HEIGHT_PX = MAP_HEIGHT * TILE_SIZE * CANVAS_SCALE;
const MAP_WIDTH_PX  = MAP_WIDTH * TILE_SIZE * CANVAS_SCALE;

const INPUT_PRIORITY: Direction[] = ["up", "left", "down", "right"];
const DIR_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  up:    { dx: 0, dy: -1 },
  down:  { dx: 0, dy: 1 },
  left:  { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const SPAWN_POINTS = build_spawns();

function build_blueprint(width: number, height: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
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
    { x: MAP_WIDTH - 2, y: 1 },
  ];
}

function create_player(x: number, y: number): BomberPlayer {
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
    inputs: { up: 0, down: 0, left: 0, right: 0 },
  };
}

function clone_player(player: BomberPlayer): BomberPlayer {
  return {
    ...player,
    inputs: { ...player.inputs },
  };
}

function is_walkable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) {
    return false;
  }
  const tile = MAP_BLUEPRINT[y][x];
  return tile !== "#";
}

function select_direction(inputs: InputState): Direction | undefined {
  for (const dir of INPUT_PRIORITY) {
    if (inputs[dir]) {
      return dir;
    }
  }
  return undefined;
}

function spawn_position_for(id: string): { x: number; y: number } {
  const idx = Math.abs(hash_string(id)) % SPAWN_POINTS.length;
  return SPAWN_POINTS[idx];
}

function hash_string(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

const initial: GameState = {};

function on_tick(state: GameState): GameState {
  const next_state: GameState = {};
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

function on_post(post: GamePost, state: GameState): GameState {
  switch (post.$) {
    case "spawn": {
      const player = create_player(post.x, post.y);
      return { ...state, [post.nick]: player };
    }
    case "press": {
      const current = state[post.nick];
      if (!current) return state;
      const updated = clone_player(current);
      updated.inputs[post.dir] = 1;
      return { ...state, [post.nick]: updated };
    }
    case "release": {
      const current = state[post.nick];
      if (!current) return state;
      const updated = clone_player(current);
      updated.inputs[post.dir] = 0;
      return { ...state, [post.nick]: updated };
    }
  }
  return state;
}

export function create_game(room: string, smooth: (past: GameState, curr: GameState) => GameState) {
  return new Vibi<GameState, GamePost>(room, initial, on_tick, on_post, smooth, TICK_RATE, TOLERANCE);
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
canvas.width = MAP_WIDTH_PX;
canvas.height = MAP_HEIGHT_PX;

const overlay = get_element<HTMLDivElement>("setup-overlay");
const step_title = get_element<HTMLHeadingElement>("setup-title");
const step_description = get_element<HTMLParagraphElement>("setup-description");
const step_form = get_element<HTMLFormElement>("setup-form");
const step_input = get_element<HTMLInputElement>("setup-input");
const step_error = get_element<HTMLSpanElement>("setup-error");

let room = "";
let nick = "";
let game: Vibi<GameState, GamePost> | null = null;

const smooth = (past: GameState, curr: GameState): GameState => {
  if (nick && curr[nick]) {
    past[nick] = curr[nick];
  }
  return past;
};

collect_session().then(({ room: selected_room, nick: selected_nick }) => {
  room = selected_room;
  nick = selected_nick;
  document.title = `Pokebomber ${pkg.version} - ${room}`;
  game = create_game(room, smooth);
  bind_inputs();
});

function bind_inputs() {
  if (!game) return;
  const KEY_TO_DIR: Record<string, Direction> = {
    w: "up",
    arrowup: "up",
    a: "left",
    arrowleft: "left",
    s: "down",
    arrowdown: "down",
    d: "right",
    arrowright: "right",
  };
  const key_states: Partial<Record<Direction, boolean>> = {};

  on_sync(() => {
    const spawn = spawn_position_for(`${room}:${nick}`);
    console.log(`[BOMBER] Synced; spawning '${nick}' at tile (${spawn.x},${spawn.y})`);
    game!.post({ $: "spawn", nick, x: spawn.x, y: spawn.y });

    function handle_key_event(e: KeyboardEvent) {
      const dir = KEY_TO_DIR[e.key.toLowerCase()];
      if (!dir) return;
      e.preventDefault();
      const is_down = e.type === "keydown";
      if (key_states[dir] === is_down) {
        return;
      }
      key_states[dir] = is_down;
      const action: GamePost["$"] = is_down ? "press" : "release";
      game!.post({ $: action, dir, nick });
    }

    window.addEventListener("keydown", handle_key_event);
    window.addEventListener("keyup", handle_key_event);

    setInterval(() => render(), 1000 / TICK_RATE);
  });
}

function grid_position(player: BomberPlayer): { renderX: number; renderY: number } {
  if (!player.moving) {
    return { renderX: player.x, renderY: player.y };
  }
  const progress = (STEP_TICKS - player.progress) / STEP_TICKS;
  const renderX = player.startX + (player.targetX - player.startX) * progress;
  const renderY = player.startY + (player.targetY - player.startY) * progress;
  return { renderX, renderY };
}

function tile_color(ch: string): string {
  switch (ch) {
    case "#":
      return "#1f1e2c";
    default:
      return "#312f43";
  }
}

function render() {
  if (!game) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0a0916";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const tile = MAP_BLUEPRINT[y][x];
      ctx.fillStyle = tile_color(tile);
      ctx.fillRect(
        x * TILE_SIZE * CANVAS_SCALE,
        y * TILE_SIZE * CANVAS_SCALE,
        TILE_SIZE * CANVAS_SCALE,
        TILE_SIZE * CANVAS_SCALE,
      );
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
    const radius = (TILE_SIZE * CANVAS_SCALE) / 2 - 2;
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
  if (!game) return;
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

function collect_session(): Promise<{ room: string; nick: string }> {
  return new Promise((resolve) => {
    let step: SetupStep = "room";
    let room_value = "";

    const step_text = {
      room: {
        title: "Escolha a sala",
        description: "Digite o nome da sala ou deixe vazio para gerar um código.",
        placeholder: "sala",
      },
      nick: {
        title: "Seu apelido",
        description: "Use apenas um caractere (ex: A, *, 7).",
        placeholder: "letra única",
      },
    } as const;

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

    const handler = (event: Event) => {
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

function get_element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el as T;
}
