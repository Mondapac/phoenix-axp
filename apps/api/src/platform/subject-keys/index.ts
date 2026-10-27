// The `platform/subject-keys` barrel (ADR-0003, ADR-0007): what modules use to encrypt
// personal data under per-subject keys.
export {
  SealedValueError,
  SubjectKeysUnavailableError,
  SEALED_OVERHEAD,
} from './subject-key-cipher';
export {
  SUBJECT_KEY_SERVICE,
  SubjectKeyService,
  type SealedSubjectData,
} from './subject-key.service';
