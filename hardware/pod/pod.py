#!/usr/bin/env python3
"""The putter-sensor pod: a puck that sits on the grip end with the board and battery inside.

Two printed parts per pod — the cup (flange + spigot + walls, with a USB-C window) and a press-fit lid.
Three cup variants from one model: B (short spigot that bites a rubber cap over a blocked shaft, e.g.
Odyssey Stroke Lab), A (long spigot into an open shaft), D (no spigot, adhesive only). All sizes in mm.
Measure the grip before printing: GRIP_D (butt diameter), VENT_D (vent-hole diameter) and, for B,
DEPTH_TO_STOP (cap surface to the counterweight) — the spigot must stay 1 mm short of it.

  pip install manifold3d trimesh numpy
  python3 pod.py --grip 33 --vent 5.5 --stop 8 --out out/
"""
import argparse, math, os
import numpy as np
import manifold3d as mf
import trimesh

# the Seeed XIAO nRF52840 Sense (datasheet) and a 401722 LiPo
BOARD = dict(l=21.0, w=17.8, pcb=1.0, parts=3.0)   # pcb thickness, tallest part (USB-C) above it
USB = dict(w=9.0, h=3.4, stick=1.2)                 # connector width, height, how far it overhangs the board edge
BATT = dict(l=22.0, w=17.0, t=4.0)
SEG = 96

def cyl(h, r, z=0.0, r2=None):
    return mf.Manifold.cylinder(h, r, r if r2 is None else r2, SEG).translate([0, 0, z])

def box(l, w, h, x=0.0, y=0.0, z=0.0):
    return mf.Manifold.cube([l, w, h]).translate([x - l / 2, y - w / 2, z])

def pod(grip_d=33.0, vent_d=5.5, stop=8.0, variant='B', wall=1.5, flange_t=2.0, lid_t=1.2, clear=0.9):
    """Returns (cup, lid) manifolds. z = 0 is the grip surface; the spigot goes to negative z."""
    ro = grip_d / 2
    ri = ro - wall
    inner_h = BATT['t'] + 0.3 + BOARD['pcb'] + BOARD['parts'] + clear          # 9.2
    lip = 1.6
    cup_h = flange_t + inner_h
    cup = cyl(cup_h, ro) - cyl(inner_h + 0.01, ri, flange_t)
    # spigot: a tapered christmas-tree plug that pushes into the vent hole and bites the rubber
    if variant == 'B':
        length = max(3.0, min(6.0, stop - 1.0))
    elif variant == 'A':
        length = 10.0
    else:
        length = 0.0
    if length:
        core = cyl(length, vent_d / 2 - 0.3, -length)
        spig = core
        n = max(2, int(length // 2))
        for i in range(n):
            z0 = -length + i * (length / n)
            spig += cyl(length / n, vent_d / 2 - 0.5, z0, r2=vent_d / 2 + 0.45)  # barb: narrow tip, wide shoulder
        cup += spig
    # board cradle: the board is centred (its corners must clear the wall); the battery lies under it on
    # the floor between two rails, and the board rests on a step in those rails. End ledges stop the
    # battery sliding lengthways. The USB-C end faces +x.
    bx = 0.0
    ledge_z = flange_t + BATT['t'] + 0.3
    for sy in (-1, 1):
        cup += box(BATT['l'] + 1.6, 1.0, ledge_z - flange_t, bx, sy * (BATT['w'] / 2 + 0.1 + 0.5), flange_t)        # lower rail, battery width
        cup += box(BOARD['l'] - 2, 0.8, inner_h - (ledge_z - flange_t) - lip - 0.2, bx, sy * (BOARD['w'] / 2 + 0.15 + 0.4), ledge_z)  # upper rail, board width
    for sx in (-1, 1):
        cup += box(1.4, BATT['w'] + 1.2, ledge_z - flange_t, bx + sx * (BATT['l'] / 2 + 0.2 + 0.7), 0, flange_t)
    # the charging slot: the wall is cut away at the USB-C end from board level to the top so the plug's
    # overmould can reach the connector (the board edge is 3–4 mm inside the wall). The lid lip is cut to match.
    slot_w = 13.0
    slot_z = flange_t + BATT['t'] - 0.6   # below the connector so a 6.6 mm plug overmould clears
    cup -= box(wall * 2 + 8, slot_w, cup_h, ri + wall / 2 + 1, 0, slot_z)
    # lid: top plate plus a press-fit lip; a notch at the back to lever it off
    lid = cyl(lid_t, ro, cup_h) + cyl(lip, ri - 0.12, cup_h - lip) - cyl(lip + 0.01, ri - 0.12 - 1.0, cup_h - lip - 0.005)
    lid -= box(wall * 2 + 8, slot_w + 0.4, lip + lid_t + 0.2, ri + wall / 2 + 1, 0, cup_h - lip - 0.05)  # the plate is bitten over the slot too
    lid -= box(4, 2, lid_t + 0.1, -ro + 1, 0, cup_h - 0.05)
    return cup, lid, dict(cup_h=cup_h, inner_h=inner_h, spigot=length, total=cup_h + lid_t, board_x=bx)

def to_trimesh(m):
    mesh = m.to_mesh()
    v = np.asarray(mesh.vert_properties)[:, :3]
    f = np.asarray(mesh.tri_verts)
    return trimesh.Trimesh(v, f, process=False)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--grip', type=float, default=33.0, help='grip butt diameter, mm')
    ap.add_argument('--vent', type=float, default=5.5, help='vent hole diameter, mm')
    ap.add_argument('--stop', type=float, default=8.0, help='B only: depth from cap surface to the hard stop, mm')
    ap.add_argument('--out', default='out')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for variant in ('B', 'A', 'D'):
        cup, lid, info = pod(a.grip, a.vent, a.stop, variant)
        tm = to_trimesh(cup)
        name = f'pod-cup-{variant}-g{a.grip:g}-v{a.vent:g}.stl'
        tm.export(os.path.join(a.out, name))
        print(f'{name}: spigot {info["spigot"]:.1f} mm, height above grip {info["total"]:.1f} mm, watertight={tm.is_watertight}, volume {tm.volume/1000:.1f} cm³')
        if variant == 'B':
            tl = to_trimesh(lid); tl.export(os.path.join(a.out, f'pod-lid-g{a.grip:g}.stl'))
            print(f'pod-lid-g{a.grip:g}.stl: watertight={tl.is_watertight}')
            (tm + tl).export(os.path.join(a.out, f'pod-assembly-B-g{a.grip:g}.stl'))

if __name__ == '__main__':
    main()
