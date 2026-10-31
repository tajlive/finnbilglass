// Stop Rules for P1 verification
// Thresholds from CTO directive: errorCount > 50, consecutive429s > 10, qualityPassRate < 0.5

export interface StopRuleResult {
  halt: boolean;
  errorTrigger: number;
  consecutive429s: number;
  qualityPassRate: number;
  reason?: string;
}

/**
 * Check stop rules based on error/quality thresholds.
 * Stops execution if any critical threshold is exceeded.
 */
export function checkStopRules(
  errorCount: number,
  consecutive429s: number,
  qualityPassRate: number
): StopRuleResult {
  const halt = errorCount > 50 || consecutive429s > 10 || qualityPassRate < 0.5;
  let reason: string | undefined;
  if (halt) {
    if (errorCount > 50) reason = `errorCount ${errorCount} > 50`;
    else if (consecutive429s > 10) reason = `consecutive429s ${consecutive429s} > 10`;
    else reason = `qualityPassRate ${qualityPassRate} < 0.5`;
  } else {
    reason = 'All checks passed';
  }
  return {
    halt,
    errorTrigger: errorCount,
    consecutive429s,
    qualityPassRate,
    reason,
  };
}
