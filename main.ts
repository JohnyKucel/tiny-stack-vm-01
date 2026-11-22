import * as fs from "node:fs";
import * as path from "node:path";

const CAP_STACK = 256, CAP_CALL = 64, CAP_MEM = 256;
const CAP_STEPS = 1000000, CAP_OUT = 65536, INT_MIN = -2147483648;
const T_UNDERFLOW = 2, T_OVERFLOW = 3, T_DIVZERO = 4, T_BADOP = 5;
const T_MEM = 6, T_CALLDEEP = 7, T_RETEMPTY = 8, T_PC = 9;
const T_STEPS = 10, T_OUTPUT = 11;

type Meta = [imm: number, pops: number, pushes: number];
const OPBYTES = "0001020304050607101112131415161718191a1b1c1d1e2021223031323334404150515253";
const OPMETA = "000101401010012022023033021021021021021021021011021021021011021021021021021021200210210200000011020010010001010";
const META: Array<Meta | undefined> = new Array(256);
for (let i = 0; i < 37; i++) {
  const k = i * 3;
  META[parseInt(OPBYTES.slice(i * 2, i * 2 + 2), 16)] = [+OPMETA[k], +OPMETA[k + 1], +OPMETA[k + 2]];
}
const enc = new TextEncoder();

function execute(prog: Uint8Array, feed: Uint8Array): { bytes: Uint8Array; code: number } {
  const stk = new Int32Array(CAP_STACK);
  const ret = new Int32Array(CAP_CALL);
  const mem = new Int32Array(CAP_MEM);
  const sink = new Uint8Array(CAP_OUT);
  let sp = 0;
  let rp = 0;
  let pc = 0;
  let ip = 0;
  let op = 0;
  let done = 0;
  const finish = (code: number): { bytes: Uint8Array; code: number } => ({
    bytes: sink.subarray(0, op),
    code,
  });
  for (;;) {
    if (done === CAP_STEPS) return finish(T_STEPS);
    if (pc < 0 || pc >= prog.length) return finish(T_PC);
    const meta = META[prog[pc]];
    if (meta === undefined) return finish(T_BADOP);
    const immLen = meta[0];
    if (pc + immLen >= prog.length) return finish(T_PC);
    done++;
    const after = pc + 1 + immLen;
    if (sp < meta[1]) return finish(T_UNDERFLOW);
    if (sp - meta[1] + meta[2] > CAP_STACK) return finish(T_OVERFLOW);
    const opcode = prog[pc];
    pc = after;
    if (opcode === 0x00) return finish(0);
    if (opcode === 0x01) {
      stk[sp++] = (prog[after - 1] << 24) >> 24;
      continue;
    }
    if (opcode === 0x02) {
      stk[sp++] = prog[after - 4] | (prog[after - 3] << 8) | (prog[after - 2] << 16) | (prog[after - 1] << 24);
      continue;
    }
    if (opcode === 0x03) { sp--; continue; }
    if (opcode === 0x04) { stk[sp] = stk[sp - 1]; sp++; continue; }
    if (opcode === 0x05) {
      const tmp = stk[sp - 1];
      stk[sp - 1] = stk[sp - 2];
      stk[sp - 2] = tmp;
      continue;
    }
    if (opcode === 0x06) { stk[sp] = stk[sp - 2]; sp++; continue; }
    if (opcode === 0x07) {
      const tmp = stk[sp - 3];
      stk[sp - 3] = stk[sp - 2];
      stk[sp - 2] = stk[sp - 1];
      stk[sp - 1] = tmp;
      continue;
    }
    if (opcode === 0x17) { stk[sp - 1] = (-stk[sp - 1]) | 0; continue; }
    if (opcode === 0x1b) { stk[sp - 1] = ~stk[sp - 1]; continue; }
    if (opcode >= 0x10 && opcode <= 0x22) {
      const rhs = stk[sp - 1];
      const lhs = stk[sp - 2];
      let val = 0;
      if (opcode === 0x10) val = (lhs + rhs) | 0;
      else if (opcode === 0x11) val = (lhs - rhs) | 0;
      else if (opcode === 0x12) val = Math.imul(lhs, rhs);
      else if (opcode === 0x13) {
        if (rhs === 0) return finish(T_DIVZERO);
        val = lhs === INT_MIN && rhs === -1 ? INT_MIN : (lhs / rhs) | 0;
      } else if (opcode === 0x14) {
        if (rhs === 0) return finish(T_DIVZERO);
        val = rhs === -1 ? 0 : (lhs % rhs) | 0;
      } else if (opcode === 0x15) {
        if (rhs === 0) return finish(T_DIVZERO);
        val = Math.floor((lhs >>> 0) / (rhs >>> 0)) | 0;
      } else if (opcode === 0x16) {
        if (rhs === 0) return finish(T_DIVZERO);
        val = ((lhs >>> 0) % (rhs >>> 0)) | 0;
      } else if (opcode === 0x18) val = lhs & rhs;
      else if (opcode === 0x19) val = lhs | rhs;
      else if (opcode === 0x1a) val = lhs ^ rhs;
      else if (opcode === 0x1c) val = lhs << (rhs & 31);
      else if (opcode === 0x1d) val = lhs >> (rhs & 31);
      else if (opcode === 0x1e) val = (lhs >>> (rhs & 31)) | 0;
      else if (opcode === 0x20) val = lhs === rhs ? 1 : 0;
      else if (opcode === 0x21) val = lhs < rhs ? 1 : 0;
      else val = (lhs >>> 0) < (rhs >>> 0) ? 1 : 0;
      sp -= 2;
      stk[sp++] = val;
      continue;
    }
    if (opcode === 0x30 || opcode === 0x31 || opcode === 0x32) {
      const rel = ((prog[after - 2] | (prog[after - 1] << 8)) << 16) >> 16;
      let go = opcode === 0x30;
      if (!go) {
        const cond = stk[--sp];
        go = opcode === 0x31 ? cond === 0 : cond !== 0;
      }
      if (go) pc = after + rel;
      continue;
    }
    if (opcode === 0x33) {
      if (rp === CAP_CALL) return finish(T_CALLDEEP);
      ret[rp++] = after;
      pc = prog[after - 2] | (prog[after - 1] << 8);
      continue;
    }
    if (opcode === 0x34) {
      if (rp === 0) return finish(T_RETEMPTY);
      pc = ret[--rp];
      continue;
    }
    if (opcode === 0x40) {
      const addr = stk[sp - 1];
      if (addr < 0 || addr >= CAP_MEM) return finish(T_MEM);
      stk[sp - 1] = mem[addr];
      continue;
    }
    if (opcode === 0x41) {
      const addr = stk[sp - 1];
      if (addr < 0 || addr >= CAP_MEM) return finish(T_MEM);
      const held = stk[sp - 2];
      sp -= 2;
      mem[addr] = held;
      continue;
    }
    if (opcode === 0x50) {
      const b = enc.encode(String(stk[sp - 1]));
      if (op + b.length > CAP_OUT) return finish(T_OUTPUT);
      sink.set(b, op);
      op += b.length;
      sp--;
      continue;
    }
    if (opcode === 0x51) {
      if (op + 1 > CAP_OUT) return finish(T_OUTPUT);
      sink[op++] = stk[--sp] & 255;
      continue;
    }
    if (opcode === 0x52) {
      stk[sp++] = ip < feed.length ? feed[ip++] : -1;
      continue;
    }
    if (opcode === 0x53) return finish(stk[--sp] & 255);
    return finish(T_BADOP);
  }
}

function readIfPresent(file: string): Uint8Array {
  try {
    return fs.readFileSync(file);
  } catch {
    return new Uint8Array(0);
  }
}

function main(): void {
  const inDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const names = fs
    .readdirSync(inDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const id of names) {
    const prog = readIfPresent(path.join(inDir, id, "program.bin"));
    const feed = readIfPresent(path.join(inDir, id, "input.bin"));
    const result = execute(prog, feed);
    const dest = path.join(outDir, id);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "stdout.bin"), result.bytes);
    fs.writeFileSync(path.join(dest, "exit.txt"), String(result.code) + "\n");
  }
}

main();
