/**
 * collision.ts - Collision detection utilities for the sword battle game.
 * Handles: sword tip vs circular player body.
 */

import type { Player } from "./Player";

/**
 * Check if a point (sword tip) collides with a circular body (player).
 * Uses distance check: point is inside circle if dist <= radius.
 */
export function pointInCircle(
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number
): boolean {
  const dx = px - cx;
  const dy = py - cy;
  const distSq = dx * dx + dy * dy;
  return distSq <= radius * radius;
}

/** Minimum distance between a line segment AB and a point C, compared to radius. */
function segmentHitsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  radius: number
): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const acx = cx - ax;
  const acy = cy - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    // Degenerate segment, fall back to point check
    return pointInCircle(ax, ay, cx, cy, radius);
  }
  let t = (acx * abx + acy * aby) / abLenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  const dx = closestX - cx;
  const dy = closestY - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Check if player A's sword tip hits player B's body.
 * Returns true if collision detected.
 */
export function swordHitsPlayer(attacker: Player, target: Player): boolean {
  if (!attacker.isAlive || !target.isAlive) return false;
  if (attacker.id === target.id) return false;
  if (attacker.hitCooldown > 0) return false;

  const tip = attacker.getSwordTip();
  const prevX = attacker.prevSwordTipX ?? tip.x;
  const prevY = attacker.prevSwordTipY ?? tip.y;

  // Continuous collision detection: if the swept segment from previous tip to current tip
  // intersects the target circle, count it as a hit.
  if (segmentHitsCircle(prevX, prevY, tip.x, tip.y, target.x, target.y, target.radius * 1.05)) {
    return true;
  }

  // Fallback: simple point-in-circle at current tip
  return pointInCircle(tip.x, tip.y, target.x, target.y, target.radius * 1.05);
}
