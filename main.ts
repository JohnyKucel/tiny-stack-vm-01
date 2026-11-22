import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// [immediate bytes, pops, pushes] per opcode, from ISA.md.
const T: Record<number, [number, number, number]> = {
  0: [0, 0, 0], 1: [1, 0, 1], 2: [4, 0, 1], 3: [0, 1, 0], 4: [0, 1, 2],
  5: [0, 2, 2], 6: [0, 2, 3], 7: [0, 3, 3], 48: [2, 0, 0], 49: [2, 1, 0],
  50: [2, 1, 0], 51: [2, 0, 0], 52: [0, 0, 0], 64: [0, 1, 1], 65: [0, 2, 0],
  80: [0, 1, 0], 81: [0, 1, 0], 82: [0, 0, 1], 83: [0, 1, 0],
};
for (const o of [16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 28, 29, 30, 32, 33, 34]) T[o] = [0, 2, 1];
for (const o of [23, 27]) T[o] = [0, 1, 1];

function run(p: Buffer, q: Buffer): [Buffer, number] {
  const n = p.length;
  const S = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let cp = 0;
  const M = new Int32Array(256);
  const out = Buffer.alloc(65536);
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const end = (e: number): [Buffer, number] => [out.subarray(0, ol), e];
  for (;;) {
    if (steps === 1000000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = p[pc];
    const t = T[op];
    if (!t) return end(5);
    const imm = t[0];
    if (pc + imm >= n) return end(9);
    steps++;
    const nx = pc + 1 + imm;
    if (sp < t[1]) return end(2);
    if (sp - t[1] + t[2] > 256) return end(3);
    pc = nx;
    if (op === 0) return end(0);
    if (op === 1) { S[sp++] = (p[nx - 1] << 24) >> 24; continue; }
    if (op === 2) { S[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); continue; }
    if (op === 3) { sp--; continue; }
    if (op === 4) { S[sp] = S[sp - 1]; sp++; continue; }
    if (op === 5) { const v = S[sp - 1]; S[sp - 1] = S[sp - 2]; S[sp - 2] = v; continue; }
    if (op === 6) { S[sp] = S[sp - 2]; sp++; continue; }
    if (op === 7) { const a = S[sp - 3]; S[sp - 3] = S[sp - 2]; S[sp - 2] = S[sp - 1]; S[sp - 1] = a; continue; }
    if (op === 23) { S[sp - 1] = -S[sp - 1] | 0; continue; }
    if (op === 27) { S[sp - 1] = ~S[sp - 1]; continue; }
    if (op >= 16 && op <= 34 && op !== 23 && op !== 27) {
      const b = S[sp - 1];
      const a = S[sp - 2];
      let r = 0;
      if (op === 16) r = (a + b) | 0;
      else if (op === 17) r = (a - b) | 0;
      else if (op === 18) r = Math.imul(a, b);
      else if (op === 19) { if (b === 0) return end(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
      else if (op === 20) { if (b === 0) return end(4); r = b === -1 ? 0 : (a % b) | 0; }
      else if (op === 21) { if (b === 0) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
      else if (op === 22) { if (b === 0) return end(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
      else if (op === 24) r = a & b;
      else if (op === 25) r = a | b;
      else if (op === 26) r = a ^ b;
      else if (op === 28) r = a << (b & 31);
      else if (op === 29) r = a >> (b & 31);
      else if (op === 30) r = (a >>> (b & 31)) | 0;
      else if (op === 32) r = a === b ? 1 : 0;
      else if (op === 33) r = a < b ? 1 : 0;
      else if (op === 34) r = (a >>> 0) < (b >>> 0) ? 1 : 0;
      sp -= 2;
      S[sp++] = r;
      continue;
    }
    if (op >= 48 && op <= 50) {
      const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
      let take = true;
      if (op !== 48) { const v = S[--sp]; take = op === 49 ? v === 0 : v !== 0; }
      if (take) pc = nx + rel;
      continue;
    }
    if (op === 51) {
      if (cp === 64) return end(7);
      C[cp++] = nx;
      pc = p[nx - 2] | (p[nx - 1] << 8);
      continue;
    }
    if (op === 52) {
      if (cp === 0) return end(8);
      pc = C[--cp];
      continue;
    }
    if (op === 64) {
      const a = S[sp - 1];
      if (a < 0 || a > 255) return end(6);
      S[sp - 1] = M[a];
      continue;
    }
    if (op === 65) {
      const a = S[sp - 1];
      if (a < 0 || a > 255) return end(6);
      sp -= 2;
      M[a] = S[sp];
      continue;
    }
    if (op === 80) {
      const s = Buffer.from(String(S[sp - 1]));
      if (ol + s.length > 65536) return end(11);
      sp--;
      s.copy(out, ol);
      ol += s.length;
      continue;
    }
    if (op === 81) {
      if (ol + 1 > 65536) return end(11);
      out[ol++] = S[--sp] & 255;
      continue;
    }
    if (op === 82) { S[sp++] = ip < q.length ? q[ip++] : -1; continue; }
    if (op === 83) return end(S[--sp] & 255);
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const dir = join(IN_DIR, id);
  let prog: Buffer;
  try { prog = readFileSync(join(dir, 'program.bin')); } catch { continue; }
  let inp = Buffer.alloc(0);
  try { inp = readFileSync(join(dir, 'input.bin')); } catch { /* no input */ }
  const [o, e] = run(prog, inp);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), o);
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), String(e) + '\n');
}
