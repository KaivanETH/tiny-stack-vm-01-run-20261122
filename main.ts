// Entry for make.fun tiny-stack-vm-01: a stack VM for the kit's ISA.
// For each /input/<id>/ it runs program.bin on input.bin and writes
// /output/<id>/stdout.bin and /output/<id>/exit.txt.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const STEP_LIMIT = 1000000, STACK_MAX = 256, CALL_MAX = 64, MEM_WORDS = 256, OUT_MAX = 65536;

// opcode -> immediate bytes, popped values, pushed values; used[op] marks a known opcode.
const immB = new Uint8Array(256), popB = new Uint8Array(256), pushB = new Uint8Array(256), used = new Uint8Array(256);
const def = (op, im, po, pu) => { used[op] = 1; immB[op] = im; popB[op] = po; pushB[op] = pu; };
def(0x00, 0, 0, 0); def(0x01, 1, 0, 1); def(0x02, 4, 0, 1);
def(0x03, 0, 1, 0); def(0x04, 0, 1, 2); def(0x05, 0, 2, 2); def(0x06, 0, 2, 3); def(0x07, 0, 3, 3);
def(0x10, 0, 2, 1); def(0x11, 0, 2, 1); def(0x12, 0, 2, 1); def(0x13, 0, 2, 1); def(0x14, 0, 2, 1);
def(0x15, 0, 2, 1); def(0x16, 0, 2, 1); def(0x17, 0, 1, 1); def(0x18, 0, 2, 1); def(0x19, 0, 2, 1);
def(0x1a, 0, 2, 1); def(0x1b, 0, 1, 1); def(0x1c, 0, 2, 1); def(0x1d, 0, 2, 1); def(0x1e, 0, 2, 1);
def(0x20, 0, 2, 1); def(0x21, 0, 2, 1); def(0x22, 0, 2, 1);
def(0x30, 2, 0, 0); def(0x31, 2, 1, 0); def(0x32, 2, 1, 0); def(0x33, 2, 0, 0); def(0x34, 0, 0, 0);
def(0x40, 0, 1, 1); def(0x41, 0, 2, 0);
def(0x50, 0, 1, 0); def(0x51, 0, 1, 0); def(0x52, 0, 0, 1); def(0x53, 0, 1, 0);

const result = (out, olen, exit) => ({ out: out.subarray(0, olen), exit });

function run(prog, input) {
  const n = prog.length;
  const D = new Int32Array(STACK_MAX), C = new Int32Array(CALL_MAX), M = new Int32Array(MEM_WORDS);
  const out = new Uint8Array(OUT_MAX);
  let sp = 0, csp = 0, pc = 0, steps = 0, ip = 0, olen = 0;
  const trap = (code) => result(out, olen, code);

  for (;;) {
    if (steps === STEP_LIMIT) return trap(10);
    if (pc < 0 || pc >= n) return trap(9);
    const op = prog[pc];
    if (!used[op]) return trap(5);
    const im = immB[op];
    if (pc + im >= n) return trap(9);
    steps++;
    const next = pc + 1 + im;
    const po = popB[op], pu = pushB[op];
    if (sp < po) return trap(2);
    if (sp - po + pu > STACK_MAX) return trap(3);
    pc = next;
    switch (op) {
      case 0x00: return result(out, olen, 0);
      case 0x01: D[sp++] = (prog[next - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const t = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = t; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x30: {
        pc = next + (((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16);
        break;
      }
      case 0x31: case 0x32: {
        const v = D[--sp];
        if (op === 0x31 ? v === 0 : v !== 0) pc = next + (((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16);
        break;
      }
      case 0x33:
        if (csp === CALL_MAX) return trap(7);
        C[csp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return trap(8);
        pc = C[--csp];
        break;
      case 0x40: {
        const a = D[sp - 1];
        if (a < 0 || a >= MEM_WORDS) return trap(6);
        D[sp - 1] = M[a];
        break;
      }
      case 0x41: {
        const a = D[sp - 1], v = D[sp - 2];
        if (a < 0 || a >= MEM_WORDS) return trap(6);
        sp -= 2; M[a] = v;
        break;
      }
      case 0x50: {
        const s = String(D[sp - 1]);
        if (olen + s.length > OUT_MAX) return trap(11);
        sp--;
        for (let k = 0; k < s.length; k++) out[olen++] = s.charCodeAt(k);
        break;
      }
      case 0x51:
        if (olen + 1 > OUT_MAX) return trap(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = ip < input.length ? input[ip++] : -1;
        break;
      case 0x53: return result(out, olen, D[--sp] & 255);
      default: {
        const b = D[sp - 1], a = D[sp - 2];
        let r;
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13:
            if (b === 0) return trap(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0; break;
          case 0x14:
            if (b === 0) return trap(4);
            r = b === -1 ? 0 : (a % b) | 0; break;
          case 0x15:
            if (b === 0) return trap(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
          case 0x16:
            if (b === 0) return trap(4);
            r = ((a >>> 0) % (b >>> 0)) | 0; break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          case 0x22: r = a >>> 0 < b >>> 0 ? 1 : 0; break;
          default: return trap(5);
        }
        sp -= 2; D[sp++] = r;
      }
    }
  }
}

// The grader mounts the set at /input and /output; the test driver names the same dirs by environment.
const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

for (const id of readdirSync(IN).sort()) {
  const prog = readFileSync(join(IN, id, 'program.bin'));
  let input = new Uint8Array(0);
  try { input = readFileSync(join(IN, id, 'input.bin')); } catch {}
  const r = run(prog, input);
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'stdout.bin'), r.out);
  writeFileSync(join(OUT, id, 'exit.txt'), String(r.exit));
}
