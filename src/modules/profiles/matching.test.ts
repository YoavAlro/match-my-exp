import { describe, expect, it } from 'vitest';
import type { Profile } from '../contracts';
import {
  PathPatternError,
  compareSpecificity,
  compilePathPattern,
  equalSpecificityConflicts,
  matchesPath,
  patternsOverlap,
  resolveProfile,
} from './matching';

const durableTarget = {
  kind: 'durable' as const,
  shadowHosts: [],
  element: { attributes: [], selector: '#main' },
};

const profile = (id: string, pathPattern: string, enabled = true): Profile => ({
  schemaVersion: 1,
  id,
  name: pathPattern,
  enabled,
  origin: 'https://example.com',
  pathPattern,
  intentSummary: 'Adapt the matching page.',
  conversationId: '00000000-0000-4000-8000-000000000099',
  operations: [
    {
      kind: 'style',
      operationId: 'style-main',
      target: durableTarget,
      declarations: [{ property: 'color', value: '#111111' }],
    },
  ],
  revision: 1,
  health: { state: 'healthy' },
  createdAt: '2026-07-15T08:00:00Z',
  updatedAt: '2026-07-15T08:00:00Z',
});

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
];

describe('path pattern matching', () => {
  it('matches literals, one segment, suffixes, and normalized slashes', () => {
    expect(matchesPath(compilePathPattern('/account'), '/account/')).toBe(true);
    expect(
      matchesPath(compilePathPattern('/account/*'), '/account/billing'),
    ).toBe(true);
    expect(
      matchesPath(compilePathPattern('/account/*'), '/account/audit/log'),
    ).toBe(false);
    expect(matchesPath(compilePathPattern('/account/**'), '/account')).toBe(
      true,
    );
    expect(
      matchesPath(compilePathPattern('/account/**'), '/account/audit/log'),
    ).toBe(true);
    expect(matchesPath(compilePathPattern('/'), '/')).toBe(true);
  });

  it('rejects malformed editable patterns', () => {
    for (const value of [
      'account',
      '/account/**/detail',
      '/account/pre*',
      '/account//detail',
      '/account?private',
      '/account data',
    ]) {
      expect(() => compilePathPattern(value)).toThrowError(PathPatternError);
    }
  });

  it('selects the most specific enabled profile and ignores URL noise', () => {
    const profiles = [
      profile(ids[0] ?? '', '/**'),
      profile(ids[1] ?? '', '/account/**'),
      profile(ids[2] ?? '', '/account/billing'),
      profile(ids[3] ?? '', '/account/billing', false),
    ];

    expect(
      resolveProfile(
        profiles,
        'https://example.com/account/billing?token=private#section',
      ),
    ).toMatchObject({
      status: 'match',
      profile: { id: ids[2] },
    });
    expect(
      resolveProfile(profiles, 'https://other.example/account/billing'),
    ).toEqual({ status: 'none' });
  });

  it('reports equal-specificity resolution conflicts', () => {
    const left = profile(ids[0] ?? '', '/team/*');
    const right = profile(ids[1] ?? '', '/*/settings');

    expect(
      resolveProfile([left, right], 'https://example.com/team/settings'),
    ).toEqual({ status: 'conflict', profileIds: [ids[0], ids[1]] });
    expect(equalSpecificityConflicts(left, [left, right])).toEqual([ids[1]]);
  });

  it('orders specificity deterministically', () => {
    const catchAll = compilePathPattern('/**');
    const account = compilePathPattern('/account/**');
    const one = compilePathPattern('/account/*');
    const exact = compilePathPattern('/account/billing');

    expect(compareSpecificity(account, catchAll)).toBeGreaterThan(0);
    expect(compareSpecificity(one, account)).toBeGreaterThan(0);
    expect(compareSpecificity(exact, one)).toBeGreaterThan(0);
  });

  it('keeps overlap detection symmetric across representative patterns', () => {
    const patterns = [
      '/',
      '/**',
      '/account',
      '/account/*',
      '/account/**',
      '/*/settings',
      '/team/settings',
    ].map(compilePathPattern);

    for (const left of patterns) {
      for (const right of patterns) {
        expect(patternsOverlap(left, right)).toBe(patternsOverlap(right, left));
      }
    }
    expect(
      patternsOverlap(
        compilePathPattern('/account/*'),
        compilePathPattern('/team/*'),
      ),
    ).toBe(false);
  });
});
