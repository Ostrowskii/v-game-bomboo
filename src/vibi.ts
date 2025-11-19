import { load, on_sync, ping, post as send_post, watch, server_time as synced_time } from "./client";

type RemotePost<PostData> = {
  room: string;
  index: number;
  server_time: number;
  client_time: number;
  name?: string;
  data: PostData;
};

export class Vibi<State, PostData> {
  private room_posts = new Map<number, RemotePost<PostData>>();
  private local_posts = new Map<string, RemotePost<PostData>>();

  constructor(
    private room: string,
    private init: State,
    private on_tick: (state: State) => State,
    private on_post: (post: PostData, state: State) => State,
    private smooth: (past: State, curr: State) => State,
    private tick_rate: number,
    private tolerance: number,
  ) {
    on_sync(() => {
      console.log(`[VIBI] synced; watching+loading room=${this.room}`);
      watch(this.room, (post) => {
        if (post.name && this.local_posts.has(post.name)) {
          this.local_posts.delete(post.name);
        }
        this.room_posts.set(post.index, post as RemotePost<PostData>);
      });
      load(this.room, 0);
    });
  }

  private time_to_tick(server_time: number): number {
    return Math.floor((server_time * this.tick_rate) / 1000);
  }

  server_time(): number {
    return synced_time();
  }

  server_tick(): number {
    return this.time_to_tick(this.server_time());
  }

  post_count(): number {
    return this.room_posts.size;
  }

  private official_time(post: RemotePost<PostData>): number {
    if (post.client_time <= post.server_time - this.tolerance) {
      return post.server_time - this.tolerance;
    }
    return post.client_time;
  }

  private official_tick(post: RemotePost<PostData>): number {
    return this.time_to_tick(this.official_time(post));
  }

  private initial_time(): number | null {
    const first = this.room_posts.get(0);
    return first ? this.official_time(first) : null;
  }

  private initial_tick(): number | null {
    const t = this.initial_time();
    return t === null ? null : this.time_to_tick(t);
  }

  private compute_state_at(at_tick: number): State {
    const starting_tick = this.initial_tick();
    if (starting_tick === null || at_tick < starting_tick) {
      return this.init;
    }

    const timeline = new Map<number, RemotePost<PostData>[]>();
    const push_post = (post: RemotePost<PostData>) => {
      const tick = this.official_tick(post);
      if (!timeline.has(tick)) {
        timeline.set(tick, []);
      }
      timeline.get(tick)!.push(post);
    };

    for (const post of this.room_posts.values()) {
      push_post(post);
    }
    for (const post of this.local_posts.values()) {
      const queued = { ...post, index: Number.MAX_SAFE_INTEGER };
      push_post(queued);
    }

    for (const posts of timeline.values()) {
      posts.sort((a, b) => a.index - b.index);
    }

    let state = this.init;
    for (let tick = starting_tick; tick <= at_tick; tick++) {
      state = this.on_tick(state);
      const posts = timeline.get(tick) || [];
      for (const post of posts) {
        state = this.on_post(post.data, state);
      }
    }
    return state;
  }

  compute_render_state(): State {
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

  compute_current_state(): State {
    return this.compute_state_at(this.server_tick());
  }

  post(data: PostData) {
    const name = send_post(this.room, data);
    const t = this.server_time();
    const local_post: RemotePost<PostData> = {
      room: this.room,
      index: -1,
      server_time: t,
      client_time: t,
      name,
      data,
    };
    this.local_posts.set(name, local_post);
  }
}
