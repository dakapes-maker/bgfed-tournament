/* Background work indicator (build 2026-11-16.01).
 *
 * A tiny store outside React state: progress ticks re-render only the
 * indicator (useSyncExternalStore), never the whole TournamentManager.
 * The App reads `isActive` (changes twice per run) to disable the buttons.
 *
 *   const busy = createBusyStore();
 *   await busy.run("Export All Data", async (p) => {
 *     p.phase("Ανάγνωση τουρνουά", 40);   // new label, counter from 0 of 40
 *     p.addTotal(5);                       // the total grows as lists are read
 *     p.tick();                            // one more item done
 *   });
 *
 * Runs may nest (e.g. a season recompute inside another flow): the inner
 * run shows its own label and the outer one's is restored when it ends. */
export function createBusyStore() {
  let state = null; // { label, done, total } | null
  let depth = 0;
  const subs = new Set();
  const set = (s) => {
    state = s;
    subs.forEach((f) => f());
  };
  return {
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
    getSnapshot: () => state,
    isActive: () => state !== null,
    async run(label, fn) {
      const saved = state;
      depth += 1;
      set({ label, done: 0, total: 0 });
      const progress = {
        phase(l, total = 0) {
          set({ label: l, done: 0, total });
        },
        addTotal(n) {
          if (state && n > 0) set({ ...state, total: state.total + n });
        },
        tick() {
          if (state) set({ ...state, done: state.done + 1 });
        },
      };
      try {
        return await fn(progress);
      } finally {
        depth -= 1;
        set(depth === 0 ? null : saved);
      }
    },
  };
}

/** Fraction 0..1 for the bar, or null when the total is not known yet
 * (the bar then runs as an animation). */
export function busyFraction(s) {
  if (!s || !s.total) return null;
  return Math.max(0, Math.min(1, s.done / s.total));
}
