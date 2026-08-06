/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { describe, expect, it } from 'vitest';
import { assessGovernedOutput } from '../../frontend/src/services/outputGovernance';

describe('governed agent output assessment', () => {
  it('accepts an output with a validation section and confidence at or above 98%', () => {
    const result = assessGovernedOutput('## Validation & Confidence\nValidation complete.\nConfidence Score: 99%');
    expect(result).toEqual({ passed: true, score: 0.99, issues: [] });
  });

  it('rejects an output below the blocking confidence threshold', () => {
    const result = assessGovernedOutput('## Validation & Confidence\nConfidence: 97%');
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.97);
    expect(result.issues).toContain('Reported confidence 97% is below the required 98%.');
  });

  it('rejects an output that omits validation evidence or a parseable score', () => {
    const result = assessGovernedOutput('A polished artifact with no governance footer.');
    expect(result.passed).toBe(false);
    expect(result.score).toBeNull();
    expect(result.issues).toEqual(expect.arrayContaining([
      'Missing Validation & Confidence section.',
      'Missing a parseable confidence score.',
    ]));
  });
});
