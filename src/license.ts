// license.ts — Ed25519 offline license key validation.
// Public key only — private key is never in the repo.
// Zero external dependencies (Node.js crypto module).

import * as crypto from 'node:crypto';
import type { Tier } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LicensePayload {
  tier: Tier;
  issued_at: string;      // ISO 8601
  expires_at: string;     // ISO 8601 or "never"
  license_id: string;     // short identifier for support
}

export type LicenseValidationResult =
  | { valid: true; payload: LicensePayload }
  | { valid: false; error: string };

// ─── Production Public Key ───────────────────────────────────────────────────
// Generated via: node scripts/keygen.mjs init
// Private key: scripts/.private-key.pem (gitignored, never committed)

export const PRODUCTION_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJzmf726WMU0NJXnqbJfOdY0HwwyNtWDjZGK+8JAogv8=
-----END PUBLIC KEY-----`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Canonical JSON serialization for signature verification.
 * Keys sorted alphabetically, no whitespace. Exported for test use.
 */
export function canonicalizePayload(payload: LicensePayload): string {
  const sorted = Object.keys(payload).sort();
  const obj: Record<string, unknown> = {};
  for (const key of sorted) {
    obj[key] = (payload as unknown as Record<string, unknown>)[key];
  }
  return JSON.stringify(obj);
}

/**
 * Base64url decode (RFC 4648 §5).
 * Node's Buffer handles base64url natively since v15.7.
 */
function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

// ─── License Key Validation ──────────────────────────────────────────────────

const LICENSE_PREFIX = 'po_pro_';  // Prefix shared by all paid tiers (pro + power)

/**
 * Validate a license key offline using Ed25519 signature verification.
 *
 * @param key - Full license key string (e.g., "po_pro_eyJ...")
 * @param publicKeyPem - Ed25519 public key PEM (defaults to PRODUCTION_PUBLIC_KEY_PEM).
 *                       Pass a test key for unit testing.
 * @returns Validation result with payload on success, error string on failure.
 */
export function validateLicenseKey(
  key: string,
  publicKeyPem?: string,
): LicenseValidationResult {
  // 1. Prefix check
  if (!key || !key.startsWith(LICENSE_PREFIX)) {
    return { valid: false, error: 'invalid_prefix' };
  }

  const encoded = key.slice(LICENSE_PREFIX.length);
  if (!encoded) {
    return { valid: false, error: 'invalid_encoding' };
  }

  // 2. Base64url decode
  let decoded: string;
  try {
    decoded = base64urlDecode(encoded).toString('utf-8');
  } catch {
    return { valid: false, error: 'invalid_encoding' };
  }

  // 3. Parse envelope
  let envelope: { payload: unknown; signature_hex: string };
  try {
    envelope = JSON.parse(decoded);
  } catch {
    return { valid: false, error: 'malformed_key' };
  }

  if (!envelope || typeof envelope !== 'object' || !envelope.payload || !envelope.signature_hex) {
    return { valid: false, error: 'malformed_key' };
  }

  // 4. Validate payload structure
  const payload = envelope.payload as Record<string, unknown>;
  if (
    typeof payload.tier !== 'string' ||
    typeof payload.issued_at !== 'string' ||
    typeof payload.expires_at !== 'string' ||
    typeof payload.license_id !== 'string'
  ) {
    return { valid: false, error: 'malformed_key' };
  }

  if (payload.tier !== 'free' && payload.tier !== 'pro' && payload.tier !== 'power') {
    return { valid: false, error: 'invalid_tier' };
  }

  const licensePayload: LicensePayload = {
    tier: payload.tier as Tier,
    issued_at: payload.issued_at as string,
    expires_at: payload.expires_at as string,
    license_id: payload.license_id as string,
  };

  // 5. Verify Ed25519 signature
  const canonical = canonicalizePayload(licensePayload);
  const signatureBuffer = Buffer.from(envelope.signature_hex, 'hex');
  const pem = publicKeyPem || PRODUCTION_PUBLIC_KEY_PEM;

  try {
    const publicKey = crypto.createPublicKey(pem);
    const isValid = crypto.verify(null, Buffer.from(canonical), publicKey, signatureBuffer);
    if (!isValid) {
      return { valid: false, error: 'invalid_signature' };
    }
  } catch {
    return { valid: false, error: 'invalid_signature' };
  }

  // 6. Check expiry
  if (licensePayload.expires_at !== 'never') {
    const expiryDate = new Date(licensePayload.expires_at);
    if (isNaN(expiryDate.getTime())) {
      return { valid: false, error: 'invalid_expiry' };
    }
    if (expiryDate <= new Date()) {
      return { valid: false, error: 'expired' };
    }
  }

  return { valid: true, payload: licensePayload };
}
