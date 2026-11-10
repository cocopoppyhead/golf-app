#!/usr/bin/env python3
"""Pull raw OpenStreetMap golf geometry for every course in public/courses/uae.json.

    python3 scripts/osm/pull.py <raw-dir> [courseId ...]

Writes <raw-dir>/<course-id>.json, one Overpass bbox (±1.8 km of the library centre) per course,
fetched in five light groups (holes/greens/tees, bunkers, water, fairways, course outlines) plus the
golf_course relations with full member geometry. Re-run until it prints "pass complete": the public
Overpass servers often answer 502/504 under load, and each run stops after ~140 s so it fits inside
a short shell timeout. Then: node scripts/osm/build.mjs <raw-dir>.

Needs a User-Agent (Overpass refuses anonymous clients) and should be run from a normal network;
sandboxed containers usually can't reach overpass-api.de. Raw pulls stay out of git (they are ~12 MB
for the UAE); only the built public/courses/osm/*.json files are committed.
"""
import json, os, sys, time, urllib.parse, urllib.request

RAW = sys.argv[1] if len(sys.argv) > 1 else '.osm'
ONLY = sys.argv[2:]
UA = 'osolo-course-pull/1.0 (open-source golf app; github cocopoppyhead/golf-app)'
HOSTS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter']
GROUPS = [
    ('core', 'way["golf"="hole"];way["golf"="green"];way["golf"="tee"];'),
    ('bunker', 'way["golf"="bunker"];'),
    ('water', 'way["golf"="water_hazard"];way["golf"="lateral_water_hazard"];way["natural"="water"];'),
    ('fair', 'way["golf"="fairway"];way["golf"="rough"];way["golf"="driving_range"];'),
    ('course', 'way["leisure"="golf_course"];relation["leisure"="golf_course"];'),
]
HALF_KM = 1.8
BUDGET_S = 140
os.makedirs(RAW, exist_ok=True)
lib = json.load(open('public/courses/uae.json'))
t0 = time.time()


def query(q):
    data = urllib.parse.urlencode({'data': q}).encode()
    last = None
    for h in HOSTS:
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(h, data=data, headers={'User-Agent': UA}), timeout=70))
        except Exception as e:  # noqa: BLE001 - try the next mirror
            last = e
    raise last


def bbox(c):
    dd = HALF_KM / 111
    return f'{c["lat"] - dd},{c["lon"] - dd * 1.1},{c["lat"] + dd},{c["lon"] + dd * 1.1}'


for c in lib:
    if ONLY and c['id'] not in ONLY: continue
    if not c.get('lat'): print('no centre', c['name']); continue
    p = os.path.join(RAW, c['id'] + '.json')
    d = json.load(open(p)) if os.path.exists(p) else {'id': c['id'], 'name': c['name'], 'lat': c['lat'], 'lon': c['lon'], 'elements': [], 'groups': {}}
    for g, sel in GROUPS:
        if g in d['groups']: continue
        if d['groups'].get('core') == 0 and g != 'course':  # nothing mapped here, skip the detail groups
            d['groups'][g] = 0; json.dump(d, open(p, 'w')); continue
        if time.time() - t0 > BUDGET_S: print('time up at', c['name'], g); sys.exit(0)
        try:
            r = query(f'[out:json][timeout:50][bbox:{bbox(c)}];({sel});out tags geom;')
            d['elements'] += r['elements']; d['groups'][g] = len(r['elements'])
            json.dump(d, open(p, 'w')); print('ok', c['name'], g, len(r['elements']), flush=True)
        except Exception as e:  # noqa: BLE001
            print('err', c['name'], g, str(e)[:70], flush=True); time.sleep(4)
    if 'rels' not in d and 'course' in d['groups']:
        if not any(e['type'] == 'relation' and e.get('tags', {}).get('leisure') == 'golf_course' for e in d['elements']):
            d['rels'] = []; json.dump(d, open(p, 'w')); continue
        if time.time() - t0 > BUDGET_S: print('time up at', c['name'], 'rels'); sys.exit(0)
        try:
            r = query(f'[out:json][timeout:50][bbox:{bbox(c)}];relation["leisure"="golf_course"];out geom;')
            d['rels'] = r['elements']; json.dump(d, open(p, 'w')); print('ok', c['name'], 'rels', len(r['elements']), flush=True)
        except Exception as e:  # noqa: BLE001
            print('err', c['name'], 'rels', str(e)[:70], flush=True); time.sleep(4)
print('pass complete')
