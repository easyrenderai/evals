/** Probability that k trials drawn from n (c of them passing) all pass: C(c,k) / C(n,k). */
export function passPowK(n: number, c: number, k: number): number {
  if (k <= 0 || k > n) return Number.NaN;
  let p = 1;
  for (let i = 0; i < k; i += 1) p *= (c - i) / (n - i);
  return Math.max(0, p);
}

export type TrialResult = {
  trial: number;
  pass: boolean;
  verdicts: Record<string, { pass: boolean; detail: string }>;
  tools: string[];
  spent: number;
  seconds: number;
  error?: string;
};

export type TaskSummary = {
  task: string;
  trials: number;
  passed: number;
  successRate: number;
  /** Chance that k trials in a row all pass; k is the trial count of this run. */
  passPowK: number;
  k: number;
  perVerifier: Record<string, number>;
};

export function summarize(task: string, results: TrialResult[]): TaskSummary {
  const n = results.length;
  const passed = results.filter((r) => r.pass).length;
  const ids = new Set(results.flatMap((r) => Object.keys(r.verdicts)));
  const perVerifier: Record<string, number> = {};
  for (const id of ids) {
    perVerifier[id] = results.filter((r) => r.verdicts[id]?.pass).length / Math.max(1, n);
  }
  return {
    task,
    trials: n,
    passed,
    successRate: n === 0 ? 0 : passed / n,
    passPowK: passPowK(n, passed, n),
    k: n,
    perVerifier,
  };
}

export function formatTable(rows: TaskSummary[]): string {
  const head = `${'task'.padEnd(24)} ${'pass'.padEnd(7)} ${'rate'.padEnd(6)} ${'pass^k'.padEnd(7)} failing constraints`;
  const lines = rows.map((r) => {
    const failing = Object.entries(r.perVerifier)
      .filter(([, rate]) => rate < 1)
      .map(([id, rate]) => `${id} ${Math.round(rate * 100)}%`)
      .join(', ');
    return `${r.task.padEnd(24)} ${`${r.passed}/${r.trials}`.padEnd(7)} ${`${Math.round(r.successRate * 100)}%`.padEnd(6)} ${r.passPowK.toFixed(2).padEnd(7)} ${failing || '-'}`;
  });
  return [head, ...lines].join('\n');
}
