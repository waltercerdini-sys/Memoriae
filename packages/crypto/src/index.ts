export { MemoriaeCryptoError, KEY_BYTES, utf8, fromUtf8 } from './sodium';
export { seal, open, type Envelope } from './envelope';
export {
  generateKey,
  deriveKeyFromPassword,
  deriveKeyFromPasskeySecret,
  combineHalves,
  wipe,
  type PasswordKdfParams,
} from './keys';
export {
  generatePersonKeyPair,
  sealToPerson,
  openForPerson,
  wrapPrivateKey,
  unwrapPrivateKey,
  encodePublicKey,
  decodePublicKey,
  type PersonKeyPair,
} from './identity';
export {
  createVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  encryptItem,
  unwrapItemKey,
  decryptItem,
  reencryptItem,
  encryptFile,
  decryptFile,
  MAX_FILE_BYTES,
  type AccessMethod,
  type EncryptedItem,
} from './vault';
export {
  createReleaseSetup,
  ownerReleaseKey,
  addFiduciary,
  deriveReleaseKeyAtActivation,
  buildRecipientPackage,
  openPackageOuter,
  openPackageInner,
  RELEASE_SCOPES,
  type ReleaseScope,
  type ReleaseSetup,
  type Fiduciary,
  type SealedFiduciaryHalf,
  type RecipientPackage,
  type PackageKind,
  type PackageItemKey,
} from './release';
export {
  generateRecoveryCode,
  recoveryKeyFromCode,
  recoveryVerifier,
  createSocialRecovery,
  openRecoveryShare,
  recoverVaultKeyWithSocial,
  type SocialRecoverySetup,
} from './recovery';
export { computeFingerprint } from './integrity';
