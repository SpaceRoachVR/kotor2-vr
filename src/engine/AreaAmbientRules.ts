/**
 * Which of an area's two ambient beds plays.
 *
 * The ARE names a day bed (AmbientSndDay) and a night bed (AmbientSndNight),
 * and IsNight is "TRUE if the area is always night, FALSE if area is always
 * day. Meaningful only if DayNightCycle is FALSE". Only one bed plays at a
 * time. The engine keeps no time of day, so a cycling area plays its day bed.
 */
export function resolveAreaAmbientSlot(area: { dayNightCycle?: boolean; isNight?: boolean }): 'day' | 'night' {
  if (!area?.dayNightCycle && area?.isNight) return 'night';
  return 'day';
}
