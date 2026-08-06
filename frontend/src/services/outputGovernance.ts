/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

export interface GovernedOutputAssessment {
  passed: boolean;
  score: number | null;
  issues: string[];
}

const VALIDATION_SECTION_RE = /(?:^|\n)#{1,6}\s*Validation\s*(?:&|and)\s*Confidence\b/i;
const CONFIDENCE_PERCENT_RE = /\bconfidence(?:\s+score)?\s*[:=-]\s*(\d+(?:\.\d+)?)\s*%/i;
const CONFIDENCE_DECIMAL_RE = /\bconfidence(?:\s+score)?\s*[:=-]\s*(0(?:\.\d+)?|1(?:\.0+)?)\b/i;

export function assessGovernedOutput(output: string, minimum = 0.98): GovernedOutputAssessment {
  const issues: string[] = [];
  if (!VALIDATION_SECTION_RE.test(output)) {
    issues.push('Missing Validation & Confidence section.');
  }

  const percent = output.match(CONFIDENCE_PERCENT_RE);
  const decimal = output.match(CONFIDENCE_DECIMAL_RE);
  const score = percent
    ? Number(percent[1]) / 100
    : decimal
      ? Number(decimal[1])
      : null;

  if (score === null || !Number.isFinite(score)) {
    issues.push('Missing a parseable confidence score.');
  } else if (score < minimum) {
    issues.push(`Reported confidence ${Math.round(score * 10000) / 100}% is below the required ${minimum * 100}%.`);
  }

  return { passed: issues.length === 0, score, issues };
}
