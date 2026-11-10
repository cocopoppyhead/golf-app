// Ball flight from launch conditions: ball speed, launch angle and spin → carry, apex, descent
// angle and hang time. A 2-D point-mass model with drag and Magnus lift whose coefficients were
// fitted to TrackMan's published tour and amateur averages (sea level, still air); within ~2–3%
// of those reference carries. It's used to sanity-check what a bay says a ball carried, and to
// put a carry on sessions that only recorded speeds. Not a substitute for a measured number.
const G = 9.81, MASS = 0.04593, RADIUS = 0.02135, AREA = Math.PI * RADIUS * RADIUS;
const MPH = 0.44704, YD = 0.9144;
// drag Cd = CD0 + CD1·S, lift Cl = CL0 + CL1·S, S = spin ratio (rω/v, capped); spin decays e^(−DECAY·t)
const CD0 = 0.19, CD1 = 0.5, CL0 = 0.12, CL1 = 0.7, DECAY = 0.13, S_MAX = 0.35;

/** Air density from temperature (°C), pressure (hPa) and altitude (m): the baseline is 15 °C at sea level. */
export function airDensity({ tempC = 15, pressureHpa = null, altitudeM = 0 } = {}) {
  const p = pressureHpa != null ? pressureHpa : 1013.25 * Math.exp(-altitudeM / 8434);
  return (p * 100) / (287.05 * (tempC + 273.15));
}

/**
 * Simulate one shot. ballSpeed mph, launch degrees, spin rpm. Returns yards/degrees/seconds:
 * { carry, apex, descent, time } or null when the inputs aren't usable.
 */
export function simulate({ ballSpeed, launch, spin, tempC = 15, pressureHpa = null, altitudeM = 0 } = {}) {
  if (!(ballSpeed > 20) || !(launch > -5 && launch < 60) || !(spin >= 0)) return null;
  const rho = airDensity({ tempC, pressureHpa, altitudeM });
  const k0 = (0.5 * rho * AREA) / MASS;
  const th = (launch * Math.PI) / 180;
  let vx = ballSpeed * MPH * Math.cos(th), vy = ballSpeed * MPH * Math.sin(th);
  let x = 0, y = 0, w = (spin * 2 * Math.PI) / 60, apex = 0, t = 0;
  const dt = 0.002;
  while (t < 15) {
    const sp = Math.hypot(vx, vy);
    const S = Math.min(S_MAX, (RADIUS * w) / sp);
    const cd = CD0 + CD1 * S, cl = CL0 + CL1 * S, k = k0 * sp;
    const ax = -k * (cd * vx + cl * vy), ay = -k * (cd * vy - cl * vx) - G;
    vx += ax * dt; vy += ay * dt;
    const ny = y + vy * dt;
    if (ny < 0 && t > 0.05) { const f = y / (y - ny); x += vx * dt * f; t += dt * f; y = 0; break; }
    x += vx * dt; y = ny; t += dt; w *= Math.exp(-DECAY * dt);
    if (y > apex) apex = y;
  }
  const descent = (Math.atan2(-vy, Math.max(1e-6, vx)) * 180) / Math.PI;
  return { carry: Math.round(x / YD), apex: Math.round(apex / YD), descent: Math.round(descent * 10) / 10, time: Math.round(t * 10) / 10 };
}

/** Predicted carry for a club summary (averages of ball speed, launch, spin); null without all three. */
export function predictedCarry(q, cond = {}) {
  const bs = q?.ballSpeed?.avg, la = q?.launch?.avg, sp = q?.backSpin?.avg;
  if (bs == null || la == null || sp == null) return null;
  return simulate({ ballSpeed: bs, launch: la, spin: sp, ...cond })?.carry ?? null;
}
