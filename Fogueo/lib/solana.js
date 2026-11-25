// Blankfire — utilidades mínimas de Solana: base58, claves ed25519 y firma de transacciones.
// Sin dependencias de red. La firma usa @noble/curves (auditada), empaquetada en lib/vendor.
import { ed25519 } from './vendor/ed25519.js';

const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = Object.fromEntries([...ALPHA].map((c, i) => [c, i]));

export function b58encode(bytes) {
  const b = [...bytes];
  let zeros = 0;
  while (zeros < b.length && b[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < b.length; i++) {
    let carry = b[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => ALPHA[d]).join('');
}
export function b58decode(str) {
  const s = String(str || '').trim();
  if (!s || /[^1-9A-HJ-NP-Za-km-z]/.test(s)) throw new Error('base58');
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  const bytes = [];
  for (let i = zeros; i < s.length; i++) {
    let carry = MAP[s[i]];
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes.reverse()]);
}
export const isAddress = (a) => { try { return b58decode(a).length === 32; } catch { return false; } };

export const b64encode = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Wallet nueva: 64 bytes como las de Solana (semilla 32 + clave pública 32).
export function newKeypair() {
  const seed = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(seed);
  const secret = new Uint8Array(64); secret.set(seed, 0); secret.set(pub, 32);
  return { secret, publicKey: pub, address: b58encode(pub) };
}
export function keypairFromSecret(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 64) throw new Error('clave');
  const pub = ed25519.getPublicKey(secret.subarray(0, 32));
  if (pub.some((b, i) => b !== secret[32 + i])) throw new Error('clave');
  return { secret, publicKey: pub, address: b58encode(pub) };
}

// ---------- Transacciones ----------
function readShortVec(buf, off) {
  let len = 0, size = 0;
  for (;;) { const b = buf[off + size]; len |= (b & 0x7f) << (size * 7); size++; if ((b & 0x80) === 0) break; if (size > 3) throw new Error('shortvec'); }
  return [len, size];
}
function shortVec(n) { const out = []; for (;;) { let b = n & 0x7f; n >>= 7; if (n) { out.push(b | 0x80); } else { out.push(b); break; } } return out; }

// Firma una transacción serializada (legacy o versionada) cuyo primer firmante es esta wallet.
// Comprueba antes que de verdad nos toca firmar (la cuenta 0 del mensaje es nuestra clave pública).
export function signTransaction(txBytes, kp) {
  const [nSig, sz] = readShortVec(txBytes, 0);
  const msgStart = sz + nSig * 64;
  const msg = txBytes.subarray(msgStart);
  const versioned = (msg[0] & 0x80) !== 0;
  const h = versioned ? 1 : 0;
  const numRequired = msg[h];
  if (numRequired < 1 || nSig < 1) throw new Error('sin firmantes');
  const [, ksz] = readShortVec(msg, h + 3);
  const first = msg.subarray(h + 3 + ksz, h + 3 + ksz + 32);
  if (first.length !== 32 || first.some((b, i) => b !== kp.publicKey[i])) throw new Error('la transacción no es de esta wallet');
  const sig = ed25519.sign(msg, kp.secret.subarray(0, 32));
  const out = new Uint8Array(txBytes);
  out.set(sig, sz);
  return { tx: out, signature: b58encode(sig) };
}

// Transferencia simple de SOL (para retirar a tu Phantom). Mensaje legacy.
export function transferTx({ from, to, lamports, blockhash }) {
  const fromPk = b58decode(from), toPk = b58decode(to), sys = new Uint8Array(32), bh = b58decode(blockhash);
  const data = new Uint8Array(12); const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); dv.setBigUint64(4, BigInt(lamports), true);
  const msg = new Uint8Array([
    1, 0, 1,                         // 1 firma, 0 de solo lectura firmadas, 1 de solo lectura (System Program)
    ...shortVec(3), ...fromPk, ...toPk, ...sys,
    ...bh,
    ...shortVec(1), 2, ...shortVec(2), 0, 1, ...shortVec(12), ...data,
  ]);
  const tx = new Uint8Array(1 + 64 + msg.length);
  tx[0] = 1; tx.set(msg, 65);
  return tx;
}
export function verifySigned(txBytes, publicKey) {
  const [nSig, sz] = readShortVec(txBytes, 0);
  return ed25519.verify(txBytes.subarray(sz, sz + 64), txBytes.subarray(sz + nSig * 64), publicKey);
}
