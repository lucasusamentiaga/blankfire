// Dinero real (lógica): base58, claves, firma de transacciones, retirada y caja fuerte cifrada.
import { b58encode, b58decode, isAddress, newKeypair, keypairFromSecret, signTransaction, transferTx, verifySigned, b64encode, b64decode } from '../Fogueo/lib/solana.js';
import { seal, open, passwordProblem } from '../Fogueo/lib/vault.js';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
const SOL = 'So11111111111111111111111111111111111111112';
// Vectores conocidos
ok(b58encode(new Uint8Array(32)) === '11111111111111111111111111111111' && b58encode(b58decode(SOL)) === SOL && b58decode(SOL).length === 32, 'base58: System Program y SOL envuelto ida y vuelta');
ok(isAddress(SOL) && !isAddress('0OIl') && !isAddress('abc'), 'reconoce direcciones válidas (sin 0, O, I ni l)');
const kp = newKeypair();
ok(kp.secret.length === 64 && kp.address.length >= 43 && keypairFromSecret(kp.secret).address === kp.address, 'wallet nueva de 64 bytes, como las de Solana');
const bad = new Uint8Array(kp.secret); bad[40] ^= 1;
let threw = false; try { keypairFromSecret(bad); } catch { threw = true; }
ok(threw, 'una clave manipulada no se acepta');
// Transacción versionada (v0) como la que devuelve Jupiter
const v0 = (payer) => { const msg = new Uint8Array([0x80, 1, 0, 1, 2, ...payer, ...new Uint8Array(32).fill(7), ...new Uint8Array(32).fill(9), 0, 0]); const tx = new Uint8Array(1 + 64 + msg.length); tx[0] = 1; tx.set(msg, 65); return tx; };
const { tx, signature } = signTransaction(v0(kp.publicKey), kp);
ok(verifySigned(tx, kp.publicKey) && b58decode(signature).length === 64, 'firma una transacción v0 de Jupiter y la firma verifica');
threw = false; try { signTransaction(v0(newKeypair().publicKey), kp); } catch (e) { threw = /no es de esta wallet/.test(e.message); }
ok(threw, 'se niega a firmar una transacción que no paga esta wallet');
// Retirada: transferencia legacy al destino exacto
const to = newKeypair().address;
const t = transferTx({ from: kp.address, to, lamports: 123456789, blockhash: b58encode(new Uint8Array(32).fill(5)) });
const signed = signTransaction(t, kp).tx;
const msg = signed.subarray(65);
ok(msg[0] === 1 && msg[1] === 0 && msg[2] === 1 && msg[3] === 3 && b58encode(msg.subarray(4, 36)) === kp.address && b58encode(msg.subarray(36, 68)) === to, 'retirada: de la wallet del bot a tu dirección, nada más');
const dv = new DataView(signed.buffer, signed.byteOffset); const dataAt = 65 + 4 + 96 + 32 + 1 + 1 + 1 + 2 + 1;
ok(dv.getUint32(dataAt, true) === 2 && dv.getBigUint64(dataAt + 4, true) === 123456789n && verifySigned(signed, kp.publicKey), 'instrucción de transferencia (2) con la cantidad exacta, firmada');
ok(b64encode(b64decode(b64encode(signed))) === b64encode(signed), 'base64 ida y vuelta');
// Caja fuerte
ok(passwordProblem('corta') && passwordProblem('aaaaaaaaaaaa') && passwordProblem('soloLetrasLargas') && !passwordProblem('fogueo-2026!'), 'contraseña: mínimo 10, no obvia, letras y números o símbolos');
const box = await seal(kp.secret, 'fogueo-2026!', { iter: 2000 });
const plain = JSON.stringify(box);
ok(box.kdf === 'PBKDF2-SHA256' && !plain.includes(b58encode(kp.secret)) && !plain.includes(b64encode(kp.secret)), 'lo guardado no contiene la clave (ni en base58 ni en base64)');
const back = await open(box, 'fogueo-2026!');
ok(back.every((b, i) => b === kp.secret[i]), 'con la contraseña buena se recupera la clave');
threw = false; try { await open(box, 'fogueo-2027!'); } catch (e) { threw = /incorrecta/.test(e.message); }
ok(threw, 'con otra contraseña, no');
const box2 = await seal(kp.secret, 'fogueo-2026!', { iter: 2000 });
ok(box2.salt !== box.salt && box2.iv !== box.iv && box2.ct !== box.ct, 'cada cifrado usa sal y vector nuevos');
const tamper = { ...box, ct: box.ct.slice(0, -4) + (box.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') };
threw = false; try { await open(tamper, 'fogueo-2026!'); } catch { threw = true; }
ok(threw, 'si alguien toca lo cifrado, no se abre (AES-GCM lo detecta)');
const real = await seal(kp.secret, 'fogueo-2026!');
ok(real.iter === 600000, 'en la extensión se usan 600.000 rondas');
console.log(fails ? `${fails} fallos` : 'TODO OK'); process.exit(fails ? 1 : 0);
