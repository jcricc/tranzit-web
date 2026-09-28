// Movement speed comes from the original clip's root translation, in T6 inches.
export function clipSpeed(clip) {
  const v = clip.delta?.trans?.values;
  if (!v || v.length < 6 || !(clip.duration > 0)) return 0;
  return Math.hypot(v.at(-3) - v[0], v.at(-2) - v[1]) / clip.duration;
}

export function crossedAttackNotifies(clip, before, after) {
  return clip.notifies.filter(n => n.name === 'fire' && n.time > before && n.time <= after);
}

// Browser wave pacing. The original GSC VM/zone activation is not emulated.
export function waveSize(round) { return Math.min(24, 6 + (round - 1) * 2); }
