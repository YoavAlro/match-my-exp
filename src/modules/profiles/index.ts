export {
  PathPatternError,
  compareSpecificity,
  compilePathPattern,
  equalSpecificityConflicts,
  matchesPath,
  patternsOverlap,
  resolveProfile,
  type CompiledPathPattern,
  type ProfileResolution,
} from './matching';
export {
  ProfileRepository,
  ProfileRepositoryError,
  type ProfileStorageMigration,
} from './repository';
export {
  ChromeProfileStorage,
  MemoryProfileStorage,
  type ProfileStorageAdapter,
} from './storage';
