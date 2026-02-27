#!/usr/bin/env node

// keygen.mjs — Ed25519 license key generator for Prompt Optimizer MCP Pro.
// Runs locally on YOUR machine only. Never deploy this. Never commit the private key.
//
// Usage:
//   node scripts/keygen.mjs init              Generate Ed25519 keypair (one-time)
//   node scripts/keygen.mjs generate 50       Generate 50 signed license keys
//   node scripts/keygen.mjs verify <key>      Verify a license key against the local public key
//
// The private key is saved to scripts/.private-key.pem (gitignored).
// The public key PEM is printed for pasting into src/license.ts.
// Generated keys are saved to scripts/keys-<timestamp>.txt.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY_PATH = path.join(__dirname, '.private-key.pem');
const PUBLIC_KEY_PATH = path.join(__dirname, '.public-key.pem');

// ─── Helpers ────────────────────────────────────────────────────────────────

function canonicalizePayload(payload) {
  const sorted = Object.keys(payload).sort();
  const obj = {};
  for (const key of sorted) {
    obj[key] = payload[key];
  }
  return JSON.stringify(obj);
}

function generateLicenseId() {
  return crypto.randomBytes(4).toString('hex'); // 8-char hex ID
}

function signLicense(payload, privateKeyPem) {
  const canonical = canonicalizePayload(payload);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(canonical), privateKey);
  const envelope = {
    payload,
    signature_hex: signature.toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  return `po_pro_${encoded}`;
}

function loadPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error('No private key found. Run: node scripts/keygen.mjs init');
    process.exit(1);
  }
  return fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');
}

function loadPublicKey() {
  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    console.error('No public key found. Run: node scripts/keygen.mjs init');
    process.exit(1);
  }
  return fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8');
}

// ─── Commands ───────────────────────────────────────────────────────────────

function cmdInit() {
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error('Private key already exists at:', PRIVATE_KEY_PATH);
    console.error('Delete it first if you want to regenerate (this invalidates ALL existing keys).');
    process.exit(1);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

  fs.writeFileSync(PRIVATE_KEY_PATH, privatePem, 'utf-8');
  fs.chmodSync(PRIVATE_KEY_PATH, 0o600);

  fs.writeFileSync(PUBLIC_KEY_PATH, publicPem, 'utf-8');

  console.log('Ed25519 keypair generated.');
  console.log('');
  console.log('Private key saved to:', PRIVATE_KEY_PATH);
  console.log('  (gitignored — NEVER share or commit this file)');
  console.log('');
  console.log('Public key (paste this into src/license.ts PRODUCTION_PUBLIC_KEY_PEM):');
  console.log('');
  console.log(publicPem.trim());
  console.log('');
  console.log('Next step: node scripts/keygen.mjs generate 50');
}

function cmdGenerate(count, tierArg) {
  const n = parseInt(count, 10);
  if (isNaN(n) || n < 1 || n > 1000) {
    console.error('Usage: node scripts/keygen.mjs generate <1-1000> [pro|power]');
    process.exit(1);
  }

  const tier = tierArg || 'pro';
  if (tier !== 'pro' && tier !== 'power') {
    console.error('Tier must be "pro" or "power". Got:', tier);
    process.exit(1);
  }

  const privateKeyPem = loadPrivateKey();
  const now = new Date().toISOString();

  const keys = [];
  for (let i = 0; i < n; i++) {
    const payload = {
      tier,
      issued_at: now,
      expires_at: 'never',
      license_id: generateLicenseId(),
    };
    const key = signLicense(payload, privateKeyPem);
    keys.push(key);
  }

  // Save to file
  const timestamp = Date.now();
  const outFile = path.join(__dirname, `keys-${tier}-${timestamp}.txt`);
  fs.writeFileSync(outFile, keys.join('\n') + '\n', 'utf-8');
  fs.chmodSync(outFile, 0o600);

  console.log(`Generated ${n} ${tier.toUpperCase()} license keys.`);
  console.log(`Saved to: ${outFile}`);
  console.log('');
  console.log('Upload these to the Lemon Squeezy product for this tier:');
  console.log('  Store > Products > [your product] > License Keys > Bulk Import');
  console.log('  Paste one key per line.');
  console.log('');
  console.log('First 3 keys (preview):');
  for (let i = 0; i < Math.min(3, keys.length); i++) {
    console.log(`  ${keys[i].slice(0, 40)}...`);
  }
}

function cmdVerify(key) {
  if (!key) {
    console.error('Usage: node scripts/keygen.mjs verify <license_key>');
    process.exit(1);
  }

  const publicKeyPem = loadPublicKey();

  // Inline validation (mirrors src/license.ts logic)
  const PREFIX = 'po_pro_';
  if (!key.startsWith(PREFIX)) {
    console.error('INVALID: missing po_pro_ prefix');
    process.exit(1);
  }

  const encoded = key.slice(PREFIX.length);
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
  } catch {
    console.error('INVALID: bad base64url encoding');
    process.exit(1);
  }

  let envelope;
  try {
    envelope = JSON.parse(decoded);
  } catch {
    console.error('INVALID: malformed JSON');
    process.exit(1);
  }

  const { payload, signature_hex } = envelope;
  const canonical = canonicalizePayload(payload);
  const signatureBuffer = Buffer.from(signature_hex, 'hex');
  const publicKey = crypto.createPublicKey(publicKeyPem);

  const isValid = crypto.verify(null, Buffer.from(canonical), publicKey, signatureBuffer);

  if (isValid) {
    console.log('VALID');
    console.log('  Tier:', payload.tier);
    console.log('  License ID:', payload.license_id);
    console.log('  Issued:', payload.issued_at);
    console.log('  Expires:', payload.expires_at);
  } else {
    console.error('INVALID: signature verification failed');
    process.exit(1);
  }
}

// ─── CLI Router ─────────────────────────────────────────────────────────────

const [command, arg, arg2] = process.argv.slice(2);

switch (command) {
  case 'init':
    cmdInit();
    break;
  case 'generate':
    cmdGenerate(arg, arg2);
    break;
  case 'verify':
    cmdVerify(arg);
    break;
  default:
    console.log(`keygen.mjs — Ed25519 license key generator

Usage:
  node scripts/keygen.mjs init                    Generate Ed25519 keypair (one-time)
  node scripts/keygen.mjs generate <N> [tier]     Generate N signed keys (tier: pro or power, default: pro)
  node scripts/keygen.mjs verify <key>            Verify a license key

Examples:
  node scripts/keygen.mjs generate 50             50 Pro keys
  node scripts/keygen.mjs generate 20 power       20 Power keys

Workflow:
  1. Run 'init' once to create your keypair
  2. Copy the public key into src/license.ts PRODUCTION_PUBLIC_KEY_PEM
  3. Run 'generate 50' for Pro keys, 'generate 20 power' for Power keys
  4. Upload keys to the corresponding Lemon Squeezy product
  5. When pool runs low, generate more

Files:
  scripts/.private-key.pem        Your private key (gitignored, chmod 600)
  scripts/.public-key.pem         Your public key (for reference)
  scripts/keys-pro-*.txt          Pro key batches (gitignored)
  scripts/keys-power-*.txt        Power key batches (gitignored)`);
    break;
}
