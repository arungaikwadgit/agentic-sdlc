/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// Display-layer fix for the admin "Created by" column (2026-07-17): no
// signup flow in this app ever collects a real full name, so
// TeamMember.name / project.creatorName is always an email local-part slug
// (e.g. "arun.gaikwad"). humanizeName() formats that into something that
// reads like a real name without inventing data. See utils/text.ts.
import { describe, it, expect } from 'vitest';
import { humanizeName } from '../../frontend/src/utils/text';

describe('humanizeName', () => {
  it('splits a dot-separated slug and title-cases each part', () => {
    expect(humanizeName('arun.gaikwad')).toBe('Arun Gaikwad');
  });

  it('splits underscore/hyphen-separated slugs too', () => {
    expect(humanizeName('preeti_hingorani')).toBe('Preeti Hingorani');
    expect(humanizeName('jane-doe')).toBe('Jane Doe');
  });

  it('normalizes all-caps or all-lowercase parts consistently', () => {
    expect(humanizeName('ARUN.GAIKWAD')).toBe('Arun Gaikwad');
    expect(humanizeName('arun.GAIKWAD')).toBe('Arun Gaikwad');
  });

  it('leaves an already-normal name unchanged', () => {
    expect(humanizeName('Jane Doe')).toBe('Jane Doe');
  });

  it('leaves a single word with no separators unchanged', () => {
    expect(humanizeName('admin')).toBe('admin');
  });

  it('handles empty/null/undefined input without throwing', () => {
    expect(humanizeName('')).toBe('');
    expect(humanizeName(null)).toBe('');
    expect(humanizeName(undefined)).toBe('');
  });

  it('trims whitespace', () => {
    expect(humanizeName('  arun.gaikwad  ')).toBe('Arun Gaikwad');
  });

  it('collapses repeated separators', () => {
    expect(humanizeName('arun..gaikwad')).toBe('Arun Gaikwad');
  });
});
