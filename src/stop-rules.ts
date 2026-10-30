export interface StopRuleResult {
  halt: boolean;
  reason: string;
}

/** Stop rule result enforced during execution, not just calculated in helpers */
export interface StopRuleResult {
  halt: boolean;
  reason: string;
  /** Error count that triggered the halt */
  errorTrigger: number;
  /** Consecutive 429 count that triggered the halt */
  consecutive429s: number;
  /** Quality pass rate at time of halt */
  qualityPassRate: number;
}

/** Check stop rules and return result - used during execution */
export function checkStopRules(
  errorCount: number,
  consecutive429s: number,
  qualityPassRate: number
): StopRuleResult {
  let halt = false;
  let reason = 'All checks passed';
  let errorTrigger = errorCount;
  let consecutive429sCount = consecutive429s;
  let qualityPassRateVal = qualityPassRate;

  if (errorCount > 50) {
    halt = true;
    reason = `Too many errors: ${errorCount}`;
    errorTrigger = errorCount;
    consecutive429sCount = consecutive429s;
    qualityPassRateVal = qualityPassRate;
  } else if (consecutive429s > 10) {
    halt = true;
    reason = `Too many 429s: ${consecutive429s}`;
    errorTrigger = errorCount;
    consecutive429sCount = consecutive429s;
    qualityPassRateVal = qualityPassRate;
  } else if (qualityPassRate < 0.5) {
    halt = true;
    reason = `Low quality pass rate: ${(qualityPassRate * 100).toFixed(1)}%`;
    errorTrigger = errorCount;
    consecutive429sCount = consecutive429s;
    qualityPassRateVal = qualityPassRate;
  }

  return { halt, reason, errorTrigger, consecutive429s: consecutive429sCount, qualityPassRate: qualityPassRateVal };
}