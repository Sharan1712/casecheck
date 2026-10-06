/** Comparing two runs case by case: what got fixed, what broke. Works across editions. */
interface RunLike {
  started_at?: string;
  summary?: { pass_rate?: number };
  cases?: Array<{ id: string; passed: boolean }>;
}

export interface Diff {
  baseline_started_at: string | undefined;
  pass_rate_before: number | undefined;
  pass_rate_after: number | undefined;
  fixed: string[];
  broken: string[];
  still_failing: string[];
  new: string[];
  removed: string[];
}

export function compare(baseline: RunLike, current: RunLike): Diff {
  const before = new Map((baseline.cases ?? []).map((c) => [c.id, c.passed]));
  const after = new Map((current.cases ?? []).map((c) => [c.id, c.passed]));
  const ids = [...after.keys()];
  return {
    baseline_started_at: baseline.started_at,
    pass_rate_before: baseline.summary?.pass_rate,
    pass_rate_after: current.summary?.pass_rate,
    fixed: ids.filter((id) => after.get(id) && before.get(id) === false),
    broken: ids.filter((id) => !after.get(id) && before.get(id) === true),
    still_failing: ids.filter((id) => !after.get(id) && before.get(id) === false),
    new: ids.filter((id) => !before.has(id)),
    removed: [...before.keys()].filter((id) => !after.has(id)),
  };
}

/** Maps case id -> 'fixed' | 'broken' | 'new' for badges in reports. */
export function statusByCase(diff?: Diff | null): Map<string, "fixed" | "broken" | "new"> {
  const out = new Map<string, "fixed" | "broken" | "new">();
  if (!diff) return out;
  for (const key of ["fixed", "broken", "new"] as const) for (const id of diff[key]) out.set(id, key);
  return out;
}
