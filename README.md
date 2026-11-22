# tiny-stack-vm-01

A tiny stack virtual machine in one TypeScript file, stdlib only.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node](https://img.shields.io/badge/Node-22-green.svg)](https://nodejs.org) [![make.fun](https://img.shields.io/badge/make.fun-bounty-blue.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122)

Run: `MAKEFUN_INPUT_DIR=<in> MAKEFUN_OUTPUT_DIR=<out> node main.ts`

It reads every `program.bin` + `input.bin`, runs the 32-bit stack ISA
(256-value stack, 64-deep calls, 256 words of memory, ten traps), and
writes `stdout.bin` and `exit.txt` per instance.
