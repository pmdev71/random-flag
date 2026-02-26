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

/**
 * Check if player A's sword tip hits player B's body.
 * Returns true if collision detected.
 */
export function swordHitsPlayer(attacker: Player, target: Player): boolean {
  if (!attacker.isAlive || !target.isAlive) return false;
  if (attacker.id === target.id) return false;
  if (attacker.hitCooldown > 0) return false;

  const tip = attacker.getSwordTip();
  return pointInCircle(tip.x, tip.y, target.x, target.y, target.radius);
}
