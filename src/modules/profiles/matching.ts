import { ProfileSchema, type Profile } from '../contracts';

type Segment =
  { kind: 'literal'; value: string } | { kind: 'one' } | { kind: 'rest' };

export interface CompiledPathPattern {
  source: string;
  segments: Segment[];
  specificity: readonly [number, number, number, number];
}

export type ProfileResolution =
  | { status: 'none' }
  | { status: 'match'; profile: Profile }
  | { status: 'conflict'; profileIds: string[] };

export class PathPatternError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'PathPatternError';
    this.code = code;
  }
}

const normalizePath = (path: string) => {
  if (!path.startsWith('/')) {
    throw new PathPatternError('path_must_start_with_slash');
  }
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
};

const pathSegments = (path: string) => {
  const normalized = normalizePath(path);
  return normalized === '/' ? [] : normalized.slice(1).split('/');
};

export const compilePathPattern = (source: string): CompiledPathPattern => {
  const normalized = normalizePath(source);
  if (/[\s\\?#]/.test(normalized)) {
    throw new PathPatternError('invalid_path_pattern');
  }
  const rawSegments = pathSegments(normalized);
  const segments: Segment[] = rawSegments.map((segment, index) => {
    if (segment === '*') {
      return { kind: 'one' };
    }
    if (segment === '**') {
      if (index !== rawSegments.length - 1) {
        throw new PathPatternError('rest_wildcard_must_be_last');
      }
      return { kind: 'rest' };
    }
    if (segment.length === 0 || segment.includes('*')) {
      throw new PathPatternError('invalid_path_segment');
    }
    return { kind: 'literal', value: segment };
  });
  const literalCount = segments.filter(({ kind }) => kind === 'literal').length;
  const wildcardCount = segments.filter(({ kind }) => kind === 'one').length;
  const restCount = segments.filter(({ kind }) => kind === 'rest').length;
  return {
    source: normalized,
    segments,
    specificity: [literalCount, -restCount, segments.length, -wildcardCount],
  };
};

export const matchesPath = (compiled: CompiledPathPattern, path: string) => {
  const candidate = pathSegments(path);
  for (let index = 0; index < compiled.segments.length; index += 1) {
    const segment = compiled.segments[index];
    if (segment?.kind === 'rest') {
      return true;
    }
    const value = candidate[index];
    if (
      value === undefined ||
      (segment?.kind === 'literal' && segment.value !== value)
    ) {
      return false;
    }
  }
  return candidate.length === compiled.segments.length;
};

export const compareSpecificity = (
  left: CompiledPathPattern,
  right: CompiledPathPattern,
) => {
  for (let index = 0; index < left.specificity.length; index += 1) {
    const difference =
      (left.specificity[index] ?? 0) - (right.specificity[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
};

export const patternsOverlap = (
  left: CompiledPathPattern,
  right: CompiledPathPattern,
) => {
  const maximum = Math.max(left.segments.length, right.segments.length);
  for (let index = 0; index < maximum; index += 1) {
    const leftSegment = left.segments[index];
    const rightSegment = right.segments[index];
    if (leftSegment?.kind === 'rest' || rightSegment?.kind === 'rest') {
      return true;
    }
    if (leftSegment === undefined || rightSegment === undefined) {
      return false;
    }
    if (
      leftSegment.kind === 'literal' &&
      rightSegment.kind === 'literal' &&
      leftSegment.value !== rightSegment.value
    ) {
      return false;
    }
  }
  return true;
};

export const equalSpecificityConflicts = (
  candidate: Profile,
  existing: readonly Profile[],
) => {
  const candidatePattern = compilePathPattern(candidate.pathPattern);
  return existing
    .filter(
      (profile) =>
        profile.id !== candidate.id &&
        profile.origin === candidate.origin &&
        profile.enabled,
    )
    .filter((profile) => {
      const pattern = compilePathPattern(profile.pathPattern);
      return (
        compareSpecificity(candidatePattern, pattern) === 0 &&
        patternsOverlap(candidatePattern, pattern)
      );
    })
    .map(({ id }) => id);
};

export const resolveProfile = (
  inputs: readonly unknown[],
  pageUrl: string,
): ProfileResolution => {
  const url = new URL(pageUrl);
  const profiles = inputs.map((input) => ProfileSchema.parse(input));
  const matches = profiles
    .filter(
      (profile) =>
        profile.enabled &&
        profile.origin === url.origin &&
        matchesPath(compilePathPattern(profile.pathPattern), url.pathname),
    )
    .map((profile) => ({
      profile,
      pattern: compilePathPattern(profile.pathPattern),
    }))
    .sort((left, right) => compareSpecificity(right.pattern, left.pattern));
  const first = matches[0];
  if (first === undefined) {
    return { status: 'none' };
  }
  const tied = matches.filter(
    ({ pattern }) => compareSpecificity(pattern, first.pattern) === 0,
  );
  if (tied.length > 1) {
    return {
      status: 'conflict',
      profileIds: tied.map(({ profile }) => profile.id).toSorted(),
    };
  }
  return { status: 'match', profile: structuredClone(first.profile) };
};
