#!/usr/bin/env python3
"""Intel HEX → UF2 for the nRF52840 UF2 bootloader (family 0xADA52840). Usage: hex2uf2.py in.hex out.uf2"""
import struct, sys
FAMILY = 0xADA52840
def parse_hex(path):
    mem = {}; base = 0
    for line in open(path):
        line = line.strip()
        if not line.startswith(':'): continue
        b = bytes.fromhex(line[1:]); n, addr, typ = b[0], (b[1] << 8) | b[2], b[3]; data = b[4:4 + n]
        if typ == 0:
            for i, v in enumerate(data): mem[base + addr + i] = v
        elif typ == 4: base = ((data[0] << 8) | data[1]) << 16
        elif typ == 2: base = ((data[0] << 8) | data[1]) << 4
        elif typ == 1: break
    return mem
def to_uf2(mem, out):
    addrs = sorted(mem); lo = addrs[0] & ~255; hi = (addrs[-1] | 255) + 1
    blocks = [a for a in range(lo, hi, 256) if any((a + i) in mem for i in range(256))]
    with open(out, 'wb') as f:
        for k, a in enumerate(blocks):
            data = bytes(mem.get(a + i, 0xFF) for i in range(256))
            hdr = struct.pack('<IIIIIIII', 0x0A324655, 0x9E5D5157, 0x2000, a, 256, k, len(blocks), FAMILY)
            f.write(hdr + data + b'\0' * (476 - 256) + struct.pack('<I', 0x0AB16F30))
    return len(blocks), lo, hi
if __name__ == '__main__':
    n, lo, hi = to_uf2(parse_hex(sys.argv[1]), sys.argv[2]); print(f'{n} blocks, 0x{lo:X}–0x{hi:X}')
