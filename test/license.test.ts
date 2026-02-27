// test/license.test.ts — License system: Ed25519 validation, storage CRUD, tier priority.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  validateLicenseKey,
  canonicalizePayload,
  PRODUCTION_PUBLIC_KEY_PEM,
} from '../src/license.js';
import type { LicensePayload } from '../src/license.js';
import { LocalFsStorage } from '../src/storage/localFs.js';
import type { LicenseData } from '../src/types.js';

// ─── Test Ed25519 Keypair ───────────────────────────────────────────────────
// Generated at module load — NOT the production keypair.

const { publicKey: testPublicKey, privateKey: testPrivateKey } =
  crypto.generateKeyPairSync('ed25519');

const TEST_PUBLIC_KEY_PEM = testPublicKey
  .export({ type: 'spki', format: 'pem' }) as string;

// ─── Test Helper: Sign a license key ────────────────────────────────────────

function signTestLicense(payload: LicensePayload): string {
  const canonical = canonicalizePayload(payload);
  const signature = crypto.sign(null, Buffer.from(canonical), testPrivateKey);
  const envelope = {
    payload,
    signature_hex: signature.toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  return `po_pro_${encoded}`;
}

// ─── Test Helper: Fresh storage ─────────────────────────────────────────────

let testDir: string;

function makeTestStorage(): LocalFsStorage {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-license-'));
  return new LocalFsStorage(testDir);
}

// ─── Default test payload ───────────────────────────────────────────────────

const TEST_PAYLOAD: LicensePayload = {
  tier: 'pro',
  issued_at: '2025-01-01T00:00:00Z',
  expires_at: 'never',
  license_id: 'test1234',
};

// ═══════════════════════════════════════════════════════════════════════════════
// License key validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('License key validation', () => {
  it('valid key passes with correct payload', () => {
    const key = signTestLicense(TEST_PAYLOAD);
    const result = validateLicenseKey(key, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.payload.tier, 'pro');
      assert.equal(result.payload.license_id, 'test1234');
      assert.equal(result.payload.expires_at, 'never');
    }
  });

  it('missing po_pro_ prefix returns invalid_prefix', () => {
    const result = validateLicenseKey('bad_key_here', TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.error, 'invalid_prefix');
  });

  it('empty string returns invalid_prefix', () => {
    const result = validateLicenseKey('', TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.error, 'invalid_prefix');
  });

  it('po_pro_ with no data returns invalid_encoding', () => {
    const result = validateLicenseKey('po_pro_', TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.error, 'invalid_encoding');
  });

  it('corrupted base64 returns invalid_encoding or malformed_key', () => {
    const result = validateLicenseKey('po_pro_!!!not-base64!!!', TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(
        result.error === 'invalid_encoding' || result.error === 'malformed_key',
        `Expected invalid_encoding or malformed_key, got: ${result.error}`,
      );
    }
  });

  it('tampered payload returns invalid_signature', () => {
    const key = signTestLicense(TEST_PAYLOAD);
    // Decode, tamper, re-encode
    const encoded = key.slice('po_pro_'.length);
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    decoded.payload.tier = 'free'; // tamper
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const result = validateLicenseKey(`po_pro_${tampered}`, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.error, 'invalid_signature');
  });

  it('wrong public key returns invalid_signature', () => {
    const key = signTestLicense(TEST_PAYLOAD);
    // Generate a different keypair
    const { publicKey: otherPub } = crypto.generateKeyPairSync('ed25519');
    const otherPem = otherPub.export({ type: 'spki', format: 'pem' }) as string;
    const result = validateLicenseKey(key, otherPem);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.error, 'invalid_signature');
  });

  it('expired key returns expired', () => {
    const expiredPayload: LicensePayload = {
      ...TEST_PAYLOAD,
      expires_at: '2020-01-01T00:00:00Z', // in the past
    };
    const key = signTestLicense(expiredPayload);
    const result = validateLicenseKey(key, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.error, 'expired');
  });

  it('expires_at "never" passes (perpetual license)', () => {
    const key = signTestLicense({ ...TEST_PAYLOAD, expires_at: 'never' });
    const result = validateLicenseKey(key, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, true);
  });

  it('future expiry date passes', () => {
    const futurePayload: LicensePayload = {
      ...TEST_PAYLOAD,
      expires_at: '2099-12-31T23:59:59Z',
    };
    const key = signTestLicense(futurePayload);
    const result = validateLicenseKey(key, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, true);
  });

  it('power tier key validates correctly', () => {
    const powerPayload = { ...TEST_PAYLOAD, tier: 'power' as const };
    const key = signTestLicense(powerPayload);
    const result = validateLicenseKey(key, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.payload.tier, 'power');
  });

  it('invalid tier returns invalid_tier', () => {
    // Sign a key with a bogus tier — need to bypass type safety
    const payload = { ...TEST_PAYLOAD, tier: 'enterprise' as 'pro' };
    const canonical = canonicalizePayload(payload);
    const signature = crypto.sign(null, Buffer.from(canonical), testPrivateKey);
    const envelope = { payload, signature_hex: signature.toString('hex') };
    const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64url');
    const result = validateLicenseKey(`po_pro_${encoded}`, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.error, 'invalid_tier');
  });

  it('malformed JSON in envelope returns malformed_key', () => {
    const garbage = Buffer.from('not json at all').toString('base64url');
    const result = validateLicenseKey(`po_pro_${garbage}`, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.error, 'malformed_key');
  });

  it('missing payload fields returns malformed_key', () => {
    const envelope = { payload: { tier: 'pro' }, signature_hex: 'deadbeef' };
    const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64url');
    const result = validateLicenseKey(`po_pro_${encoded}`, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.error, 'malformed_key');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Canonical payload
// ═══════════════════════════════════════════════════════════════════════════════

describe('Canonical payload', () => {
  it('keys are sorted alphabetically', () => {
    const canonical = canonicalizePayload(TEST_PAYLOAD);
    const parsed = JSON.parse(canonical);
    const keys = Object.keys(parsed);
    const sorted = [...keys].sort();
    assert.deepEqual(keys, sorted);
  });

  it('no whitespace in canonical form', () => {
    const canonical = canonicalizePayload(TEST_PAYLOAD);
    assert.ok(!canonical.includes(' '), 'Canonical form should have no spaces');
    assert.ok(!canonical.includes('\n'), 'Canonical form should have no newlines');
  });

  it('is deterministic across different key orderings', () => {
    const a: LicensePayload = {
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'abc',
    };
    // Same data but defined in different order (TS objects don't guarantee order)
    const b = { license_id: 'abc', expires_at: 'never', tier: 'pro' as const, issued_at: '2025-01-01T00:00:00Z' };
    assert.equal(canonicalizePayload(a), canonicalizePayload(b));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Production public key
// ═══════════════════════════════════════════════════════════════════════════════

describe('Production public key', () => {
  it('contains a valid Ed25519 public key (not a placeholder)', () => {
    assert.ok(PRODUCTION_PUBLIC_KEY_PEM.includes('BEGIN PUBLIC KEY'));
    assert.ok(PRODUCTION_PUBLIC_KEY_PEM.includes('END PUBLIC KEY'));
    assert.ok(!PRODUCTION_PUBLIC_KEY_PEM.includes('PLACEHOLDER'),
      'Production key must not contain PLACEHOLDER');
    // Ed25519 public key base64 is ~44 chars
    const base64Body = PRODUCTION_PUBLIC_KEY_PEM
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .trim();
    assert.ok(base64Body.length > 20, 'Key body should be non-trivial');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Storage license methods
// ═══════════════════════════════════════════════════════════════════════════════

describe('Storage license methods', () => {
  let storage: LocalFsStorage;

  beforeEach(() => {
    storage = makeTestStorage();
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('getLicense returns null on fresh storage', async () => {
    const license = await storage.getLicense();
    assert.equal(license, null);
  });

  it('setLicense + getLicense round-trip', async () => {
    const data: LicenseData = {
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'round-trip',
      activated_at: '2025-06-01T00:00:00Z',
      valid: true,
    };
    await storage.setLicense(data);
    const loaded = await storage.getLicense();
    assert.ok(loaded);
    assert.equal(loaded.tier, 'pro');
    assert.equal(loaded.license_id, 'round-trip');
    assert.equal(loaded.valid, true);
  });

  it('clearLicense removes license', async () => {
    const data: LicenseData = {
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'clear-me',
      activated_at: '2025-06-01T00:00:00Z',
      valid: true,
    };
    await storage.setLicense(data);
    await storage.clearLicense();
    const loaded = await storage.getLicense();
    assert.equal(loaded, null);
  });

  it('clearLicense is safe when no license exists', async () => {
    // Should not throw
    await storage.clearLicense();
    const loaded = await storage.getLicense();
    assert.equal(loaded, null);
  });

  it('getLicense marks expired license as invalid', async () => {
    const data: LicenseData = {
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: '2020-01-01T00:00:00Z', // already expired
      license_id: 'expired-test',
      activated_at: '2025-06-01T00:00:00Z',
      valid: true, // stored as valid, but should flip on read
    };
    await storage.setLicense(data);
    const loaded = await storage.getLicense();
    assert.ok(loaded);
    assert.equal(loaded.valid, false);
    assert.equal(loaded.validation_error, 'expired');
  });

  it('license file permissions are 0o600 on POSIX', async () => {
    // Skip on Windows
    if (process.platform === 'win32') return;

    const data: LicenseData = {
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'perms-test',
      activated_at: '2025-06-01T00:00:00Z',
      valid: true,
    };
    await storage.setLicense(data);
    const licenseFile = path.join(testDir, 'license.json');
    const stat = fs.statSync(licenseFile);
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, `Expected 0600, got ${mode.toString(8)}`);
  });

  it('corrupt license.json returns null (not throw)', async () => {
    const licenseFile = path.join(testDir, 'license.json');
    fs.writeFileSync(licenseFile, '{{{corrupt json!!!', 'utf-8');
    const loaded = await storage.getLicense();
    assert.equal(loaded, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tier derivation priority
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tier derivation priority', () => {
  let storage: LocalFsStorage;

  // Save and restore env var
  const originalEnv = process.env.PROMPT_OPTIMIZER_PRO;

  beforeEach(() => {
    storage = makeTestStorage();
    delete process.env.PROMPT_OPTIMIZER_PRO;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PROMPT_OPTIMIZER_PRO = originalEnv;
    } else {
      delete process.env.PROMPT_OPTIMIZER_PRO;
    }
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('no license + no env → free', async () => {
    const usage = await storage.getUsage();
    assert.equal(usage.tier, 'free');
  });

  it('no license + env true → pro', async () => {
    process.env.PROMPT_OPTIMIZER_PRO = 'true';
    const usage = await storage.getUsage();
    assert.equal(usage.tier, 'pro');
  });

  it('valid license + no env → pro', async () => {
    const data: LicenseData = {
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'priority-1',
      activated_at: '2025-06-01T00:00:00Z',
      valid: true,
    };
    await storage.setLicense(data);
    const usage = await storage.getUsage();
    assert.equal(usage.tier, 'pro');
  });

  it('valid license overrides env false', async () => {
    // env var not set (defaults to free), but license says pro
    delete process.env.PROMPT_OPTIMIZER_PRO;
    const data: LicenseData = {
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'priority-2',
      activated_at: '2025-06-01T00:00:00Z',
      valid: true,
    };
    await storage.setLicense(data);
    const usage = await storage.getUsage();
    assert.equal(usage.tier, 'pro');
  });

  it('expired license + env true → pro (env fallback)', async () => {
    process.env.PROMPT_OPTIMIZER_PRO = 'true';
    const data: LicenseData = {
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: '2020-01-01T00:00:00Z', // expired
      license_id: 'priority-3',
      activated_at: '2025-06-01T00:00:00Z',
      valid: false, // marked invalid
      validation_error: 'expired',
    };
    await storage.setLicense(data);
    const usage = await storage.getUsage();
    assert.equal(usage.tier, 'pro');
  });

  it('clearLicense → tier reverts to free', async () => {
    const data: LicenseData = {
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'revert',
      activated_at: '2025-06-01T00:00:00Z',
      valid: true,
    };
    await storage.setLicense(data);
    let usage = await storage.getUsage();
    assert.equal(usage.tier, 'pro');

    await storage.clearLicense();
    usage = await storage.getUsage();
    assert.equal(usage.tier, 'free');
  });
});
