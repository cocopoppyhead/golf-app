# Putter-sensor pod

A printed puck that sits on the grip end and holds a Seeed XIAO nRF52840 Sense over a 401722 LiPo.
`pod.py` is the whole model (manifold3d + trimesh); `out/` holds the last generated STLs.

Parts per pod: one **cup** (flange, spigot, walls, board cradle, charging slot) and one **lid** (press-fit).
Cup variants: **B** short barbed spigot for a rubber cap over a blocked shaft (Odyssey Stroke Lab /
Ai-ONE); **A** 10 mm spigot for an open shaft; **D** flat, adhesive only. Print in SLS PA12 (nylon):
the barbs and the lid lip need its toughness; a 0.4 mm FDM print will work for a fit check only.

Before printing, measure the grip with calipers and regenerate:

    pip install manifold3d trimesh numpy
    python3 pod.py --grip 33 --vent 5.5 --stop 8 --out out

`--grip` butt diameter, `--vent` vent-hole diameter, `--stop` (B) depth from the cap surface to the
counterweight; the spigot stops 1 mm short of it. Assembly: battery on the floor between the lower
rails, Kapton over it, board on the rail step with the USB-C facing the slot, two wires soldered to the
BAT pads, lid pressed on. Height above the grip ≈ 12.4 mm; 33 mm wide for a jumbo grip.

## Build pack

`out/osolo-putter-pod-build-pack.pdf`, three sheets: the print drawing for the print shop (sections, sizes,
material, quantities), the wiring (the battery's two wires to BAT+ / BAT−, nothing else), and the assembly
in order. Regenerate with `python3 drawing.py` after changing GRIP / VENT / STOP at its top.
