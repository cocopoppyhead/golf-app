#!/usr/bin/env python3
"""The build pack: print drawing, wiring and assembly sheets (3-page PDF) from the same model as pod.py.
  pip install manifold3d trimesh numpy shapely matplotlib
  python3 drawing.py   # edit GRIP, VENT, STOP below to match the measured putter
"""
import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pod, numpy as np, textwrap
TW=lambda t,n: '\n'.join(textwrap.wrap(t,n))
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Polygon, Rectangle, FancyBboxPatch, Circle
from shapely.geometry import Polygon as SP
from shapely.ops import unary_union

GRIP, VENT, STOP = 33.0, 5.5, 8.0
INK='#1d2433'; MUTE='#6b7385'; ACC='#0f7a43'; RED='#c0392b'; HATCH='#1d2433'
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':8.5,'text.color':INK,'axes.edgecolor':INK})

cup,lid,info=pod.pod(GRIP,VENT,STOP,'B')
cupA,_,infoA=pod.pod(GRIP,VENT,STOP,'A')
C=pod.to_trimesh(cup); L=pod.to_trimesh(lid); CA=pod.to_trimesh(cupA)

def section(m, normal, keep):
    s=m.section(plane_origin=(0,0,0) if normal!=(0,0,1) else (0,0,keep[2]), plane_normal=normal)
    polys=[]
    for d in s.discrete:
        p=d[:, [keep[0], keep[1]]] if normal!=(0,0,1) else d[:, [0,1]]
        if len(p)>=3: polys.append(SP(p).buffer(0))
    # even-odd: biggest minus holes
    polys.sort(key=lambda p:-p.area)
    out=None
    for p in polys:
        if out is None: out=p
        elif out.contains(p.representative_point()) and not any(q.contains(p.representative_point()) for q in []): out=out.symmetric_difference(p)
        else: out=out.symmetric_difference(p)
    return out

def draw_geom(ax, g, dx=0, dy=0, fc='#e9edf3', hatch='////'):
    geoms=[g] if g.geom_type=='Polygon' else list(g.geoms)
    for p in geoms:
        if p.is_empty: continue
        x,y=p.exterior.xy
        ax.add_patch(Polygon(np.c_[np.array(x)+dx,np.array(y)+dy],closed=True,fc=fc,ec=INK,lw=0.9,hatch=hatch))
        for h in p.interiors:
            x,y=h.xy; ax.add_patch(Polygon(np.c_[np.array(x)+dx,np.array(y)+dy],closed=True,fc='white',ec=INK,lw=0.9))

def dim(ax,p1,p2,txt,off=(0,0),side='h',fs=8):
    (x1,y1),(x2,y2)=p1,p2; ox,oy=off
    ax.annotate('',xy=(x1+ox,y1+oy),xytext=(x2+ox,y2+oy),arrowprops=dict(arrowstyle='<->',lw=0.7,color=INK,shrinkA=0,shrinkB=0))
    for (x,y) in (p1,p2):
        if ox or oy: ax.plot([x,x+ox*1.08],[y,y+oy*1.08],lw=0.4,color=MUTE)
    mx,my=(x1+x2)/2+ox,(y1+y2)/2+oy
    if side=='h': ax.text(mx,my+0.6,txt,ha='center',va='bottom',fontsize=fs)
    else: ax.text(mx+0.7,my,txt,ha='left',va='center',fontsize=fs)

def frame(fig,title,sub,sheet):
    fig.text(0.04,0.95,title,fontsize=17,fontweight='bold',va='top')
    fig.text(0.04,0.905,sub,fontsize=9.5,color=MUTE,va='top')
    fig.add_artist(Rectangle((0.02,0.02),0.96,0.96,transform=fig.transFigure,fill=False,lw=1,ec=INK))
    # title block
    tb=fig.add_axes([0.70,0.025,0.275,0.085]); tb.axis('off'); tb.set_xlim(0,1); tb.set_ylim(0,1)
    tb.add_patch(Rectangle((0,0),1,1,fill=False,lw=0.8,ec=INK)); tb.plot([0,1],[0.5,0.5],lw=0.5,color=INK); tb.plot([0.62,0.62],[0,1],lw=0.5,color=INK)
    tb.text(0.03,0.75,'osolo putter pod, v1',fontsize=9,fontweight='bold',va='center')
    tb.text(0.03,0.25,f'Ø{GRIP:g} / vent {VENT:g} / stop {STOP:g}: to confirm',fontsize=6.5,va='center',color=RED)
    tb.text(0.65,0.75,f'Sheet {sheet} of 3',fontsize=8,va='center'); tb.text(0.65,0.25,'mm, 13 Nov 2026',fontsize=7.5,va='center')

pdf=PdfPages(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'osolo-putter-pod-build-pack.pdf'))
W,H=11.69,8.27

# ---------- sheet 1: for the printer ----------
fig=plt.figure(figsize=(W,H))
frame(fig,'Print drawing: putter pod cup and lid','For the print shop. Print from the STL files; this sheet is the reference for checking them.',1)
# section through the rails (YZ) — cup B + lid
ax=fig.add_axes([0.03,0.42,0.36,0.44]); ax.set_aspect('equal'); ax.axis('off')
g=section(C,(1,0,0),(1,2)); draw_geom(ax,g)
gl=section(L,(1,0,0),(1,2)); draw_geom(ax,gl,fc='#dff1e6',hatch='\\\\\\\\')
ax.set_xlim(-24,26); ax.set_ylim(-10,19)
ax.plot([-20,20],[0,0],lw=0.6,color=MUTE,ls=(0,(6,2,1,2)))
ax.text(-23.5,-1.6,'grip surface',fontsize=6.5,color=MUTE)
dim(ax,(-16.5,12.4),(16.5,12.4),f'Ø{GRIP:g}',off=(0,3.2))
dim(ax,(16.5,0),(16.5,12.4),'12.4',off=(3.5,0),side='v')
dim(ax,(3.2,-6),(3.2,0),f'{info["spigot"]:.1f} spigot',off=(6.5,0),side='v')
ax.text(-16.5-3.5,1,'',)
ax.set_title('Section A–A (across the rails), cup B with lid',fontsize=9,loc='left',color=INK)
# section along X (shows the charging slot)
ax=fig.add_axes([0.38,0.42,0.33,0.44]); ax.set_aspect('equal'); ax.axis('off')
g=section(C,(0,1,0),(0,2)); draw_geom(ax,g); gl=section(L,(0,1,0),(0,2)); draw_geom(ax,gl,fc='#dff1e6',hatch='\\\\\\\\')
ax.set_xlim(-22,26); ax.set_ylim(-10,19)
ax.annotate('USB-C charging slot\n13 wide, open to the top',xy=(16,8),xytext=(17,-6),fontsize=7,arrowprops=dict(arrowstyle='->',lw=0.6,color=INK))
ax.annotate('lever notch',xy=(-15.5,12.2),xytext=(-21,16.5),fontsize=7,arrowprops=dict(arrowstyle='->',lw=0.6,color=INK))
ax.annotate(f'barbed spigot\nØ{VENT:g} vent + 0.45 bite',xy=(-2.8,-4),xytext=(-21,-8.5),fontsize=7,arrowprops=dict(arrowstyle='->',lw=0.6,color=INK))
ax.set_title('Section B–B (along the board)',fontsize=9,loc='left')
# plan view
ax=fig.add_axes([0.72,0.47,0.25,0.39]); ax.set_aspect('equal'); ax.axis('off')
g=section(C,(0,0,1),(0,1,4.0)); draw_geom(ax,g,fc='#e9edf3',hatch='')
ax.add_patch(Circle((0,0),16.5,fill=False,lw=0.9,ec=INK))
ax.add_patch(Rectangle((-11,-8.5),22,17,fill=False,ls='--',lw=0.7,ec=ACC)); ax.text(0,0,'LiPo 22 × 17 × 4',ha='center',va='center',fontsize=7,color=ACC)
ax.add_patch(Rectangle((-10.5,-8.9),21,17.8,fill=False,ls=':',lw=0.7,ec=INK))
ax.set_xlim(-19,22); ax.set_ylim(-19,21)
ax.annotate('board 21 × 17.8\n(dotted)',xy=(-10.5,8.9),xytext=(-18,15.5),fontsize=7,arrowprops=dict(arrowstyle='->',lw=0.6))
ax.annotate('slot →',xy=(16,0),xytext=(17.2,0),fontsize=7,va='center')
ax.set_title('Plan, cut at battery height',fontsize=9,loc='left')
# spec table
ax=fig.add_axes([0.03,0.04,0.65,0.34]); ax.axis('off'); ax.set_xlim(0,1); ax.set_ylim(0,1)
rows=[('Material','PA12 nylon, SLS or MJF (e.g. JLC3DP, Shapeways, a local SLS bureau). Not resin: the barbs and lid lip crack.'),
      ('Finish','As printed (grey or dyed black). No support marks on the lid lip or the spigot barbs.'),
      ('Quantity','3 × cup B, 1 × cup A, 1 × cup D, 5 × lid (one spare). Cups A and D are for friends\' putters.'),
      ('Files',f'pod-cup-B-g{GRIP:g}-v{VENT:g}.stl · pod-cup-A-g{GRIP:g}-v{VENT:g}.stl · pod-cup-D-g{GRIP:g}-v{VENT:g}.stl · pod-lid-g{GRIP:g}.stl'),
      ('Tolerances','±0.15 on the lid lip (it press-fits into the cup with 0.12 clearance). Everything else ±0.2.'),
      ('Orientation','Printer\'s choice for SLS/MJF. For a test print on an FDM machine: cup flange-down with supports under the spigot, lid top-down, 0.2 layers, 100% infill.'),
      ('Before ordering','Measure the putter (sheet 3, step 1) and regenerate the files if any number differs from the title block.')]
y=0.96
for k,v in rows:
    ax.text(0,y,k,fontweight='bold',va='top',fontsize=8.5); ax.text(0.17,y,TW(v,120),va='top',fontsize=8.5)
    y-=0.135
pdf.savefig(fig); plt.close(fig)

# ---------- sheet 2: wiring ----------
fig=plt.figure(figsize=(W,H))
frame(fig,'Wiring: one battery, two wires','The motion sensor, Bluetooth and charger are all on the XIAO board. The only soldering is the battery.',2)
ax=fig.add_axes([0.04,0.16,0.62,0.7]); ax.axis('off'); ax.set_xlim(0,100); ax.set_ylim(0,70); ax.set_aspect('equal')
# board
ax.add_patch(FancyBboxPatch((8,22),46,36,boxstyle='round,pad=0.4,rounding_size=2',fc='#eef2f7',ec=INK,lw=1.2))
ax.text(31,54.5,'Seeed XIAO nRF52840 Sense',ha='center',fontsize=10,fontweight='bold')
ax.text(31,50.5,'underside view (the side with the pads)',ha='center',fontsize=7.5,color=MUTE)
for i,(t,y) in enumerate((('6-axis IMU (LSM6DS3)',44),('Bluetooth 5 radio',39.5),('LiPo charger, 50 mA',35))):
    ax.add_patch(Rectangle((12,y-1.6),22,3.2,fc='white',ec=MUTE,lw=0.6)); ax.text(23,y,t,ha='center',va='center',fontsize=7.2,color=MUTE)
ax.add_patch(Rectangle((-1,35),9.5,8,fc='#c9d1de',ec=INK,lw=1)); ax.text(3.7,39,'USB-C',ha='center',va='center',fontsize=7.5,rotation=90)
ax.text(3.7,31.5,'charge &\nflash',ha='center',va='top',fontsize=7,color=MUTE)
# pads
for (y,t,col) in ((30,'BAT+',RED),(25.5,'BAT−',INK)):
    ax.add_patch(Rectangle((44,y-1.4),6,2.8,fc='#e8c46a',ec=INK,lw=0.8)); ax.text(42.6,y,t,ha='right',va='center',fontsize=9,fontweight='bold',color=col)
# battery
ax.add_patch(FancyBboxPatch((70,18),24,16,boxstyle='round,pad=0.3,rounding_size=1.5',fc='#f3f5f8',ec=INK,lw=1.2))
ax.text(82,28.5,'LiPo 401722',ha='center',fontsize=10,fontweight='bold'); ax.text(82,24.5,'3.7 V · 100 mAh',ha='center',fontsize=8); ax.text(82,21,'protection board on the tab end',ha='center',fontsize=6.5,color=MUTE)
ax.add_patch(Rectangle((66.5,22.5),3.5,9,fc='#dfe5ee',ec=INK,lw=0.8))
# wires
ax.plot([50,58,58,66.5],[30,30,29.5,29.5],color=RED,lw=2.4,solid_capstyle='round')
ax.plot([50,60,60,66.5],[25.5,25.5,24.5,24.5],color=INK,lw=2.4,solid_capstyle='round')
ax.text(58.5,32,'red',fontsize=7.5,color=RED); ax.text(60.5,21.8,'black',fontsize=7.5)
ax.text(58,13,'about 25 mm each, keep the original battery leads if they reach',ha='center',fontsize=7.5,color=MUTE)
# notes
ax2=fig.add_axes([0.66,0.16,0.31,0.7]); ax2.axis('off'); ax2.set_xlim(0,1); ax2.set_ylim(0,1)
notes=[('Polarity','Red to BAT+, black to BAT−. Reversed, it can kill the charger chip. Check the battery label before cutting anything: some cells use red and blue, or red and black on a connector.'),
       ('No switch','The firmware sleeps when the putter is still and wakes on movement. Nothing to wire.'),
       ('Charging','USB-C at 50 mA, 2 to 3 hours from flat. The small LED by the USB-C lights while it charges.'),
       ('Kapton tape','Over the battery before the board goes on top, so the board\'s underside can\'t touch the cell.'),
       ('Never','Let the two battery leads touch, cut both at once, or solder with the iron above 350 °C on the cell side.')]
y=0.98
for k,v in notes:
    ax2.text(0,y,k,fontweight='bold',va='top',fontsize=9); ax2.text(0,y-0.045,TW(v,58),va='top',fontsize=8.3)
    y-=0.19
pdf.savefig(fig); plt.close(fig)

# ---------- sheet 3: assembly ----------
fig=plt.figure(figsize=(W,H))
frame(fig,'Assembly, in order','About 30 minutes a pod once you have done one. Flash and test each board before it goes in.',3)
ax=fig.add_axes([0.03,0.14,0.30,0.72]); ax.set_aspect('equal'); ax.axis('off')
# exploded stack (schematic, to scale)
def blk(x,y,w,h,fc,label):
    ax.add_patch(Rectangle((x-w/2,y),w,h,fc=fc,ec=INK,lw=0.9)); ax.text(x+w/2+1.5,y+h/2,label,va='center',fontsize=8)
g=section(C,(1,0,0),(1,2)); draw_geom(ax,g,dy=0)
blk(0,38,33,1.2,'#dff1e6','lid: presses on')
blk(0,29,17.8,1.0,'#cfd7e3','XIAO board: USB-C to the slot'); ax.add_patch(Rectangle((-8.9,30),17.8,2.4,fc='none',ec=MUTE,lw=0.5,ls=':'))
blk(0,23,17,0.3,'#f6d27a','Kapton tape')
blk(0,15,17,4,'#f3f5f8','LiPo: tab to the slot')
ax.text(18.5,4,'cup (printed)',fontsize=8,va='center')
ax.plot([0,0],[-7,40],lw=0.4,color=MUTE,ls=(0,(6,2,1,2)))
ax.set_xlim(-20,50); ax.set_ylim(-8,42)
ax2=fig.add_axes([0.36,0.12,0.61,0.76]); ax2.axis('off'); ax2.set_xlim(0,1); ax2.set_ylim(0,1)
steps=[('Measure the putter','Calipers across the grip end (the butt, about 33), a drill-bit shank in the vent hole (the largest that slides in), a cocktail stick down the hole to the hard stop and mark the depth. Send the three numbers; the files are regenerated before printing.'),
       ('Flash each board','Plug a board into the laptop, double-tap the tiny reset button by the USB-C; a drive called XIAO-SENSE appears. Drag osolo-putt-v1.uf2 onto it. It reboots. Tap the board on the desk: the green LED blinks.'),
       ('Tin the pads','Board upside down in a helping hand. A dab of flux, then a little solder on BAT+ and BAT−. Fine tip, 320–340 °C, 2 seconds a pad.'),
       ('Solder the battery','Trim and tin one battery lead at a time, never both cut together. Red to BAT+, black to BAT−. Unplug the USB first. Check with a multimeter: 3.7–4.2 V across the pads.'),
       ('Test it alive','Plug USB back in: the charge LED lights. Unplug: tap the board, the green LED still blinks, so it runs on the battery. On the phone, the free nRF Connect app lists a device called osolo.'),
       ('Fit it','Battery flat on the cup floor between the low rails, leads towards the slot. Kapton over it. Fold the wires into the gap at the slot end, board on the rail step, USB-C facing the slot.'),
       ('Close and fit to the putter','Press the lid on (notch opposite the slot). Push the spigot into the grip\'s vent hole with a twist until the flange sits flat. If it\'s loose, a 33 mm ring of 1 mm VHB tape under the flange.')]
y=0.99
for i,(k,v) in enumerate(steps,1):
    ax2.add_patch(Circle((0.015,y-0.012),0.014,color=ACC,transform=ax2.transAxes)); ax2.text(0.015,y-0.012,str(i),color='white',ha='center',va='center',fontsize=8,fontweight='bold')
    ax2.text(0.045,y,k,fontweight='bold',va='top',fontsize=9.2)
    ax2.text(0.045,y-0.035,TW(v,110),va='top',fontsize=8.2)
    y-=0.135
ax3=fig.add_axes([0.03,0.025,0.64,0.07]); ax3.axis('off'); ax3.set_xlim(0,1); ax3.set_ylim(0,1)
ax3.text(0,0.9,'Tools',fontweight='bold',va='top',fontsize=8.5)
ax3.text(0.07,0.9,TW('Fine-tip soldering iron (temperature controlled), thin solder (0.5–0.8 mm), flux pen, helping hand, flush cutters, multimeter, Kapton tape, digital calipers, 1 mm VHB tape (optional), USB-C data cable.',105),va='top',fontsize=8)
pdf.savefig(fig); plt.close(fig)
pdf.close()
