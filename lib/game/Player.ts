/**
 * Player.ts - Represents a country/player entity in the sword battle game.
 * Each player has a flag, position, rotating sword, and life.
 */

export interface PlayerConfig {
  id: string;
  countryName: string;
  flagImage: string; // Emoji flag or image URL
  x: number;
  y: number;
  radius?: number;
  swordLength?: number;
  swordDamage?: number;
  /** Base movement speed for random wandering (pixels per frame) */
  moveSpeed?: number;
}

export class Player {
  readonly id: string;
  readonly countryName: string;
  readonly flagImage: string;
  /** Body radius - used for collision detection and rendering */
  readonly radius: number;

  /** Current position in arena */
  x: number;
  y: number;

  /** Sword rotation angle in radians (0 = right, increases counter-clockwise) */
  direction: number;

  /** Current life (0-100). When 0, player is eliminated. */
  life: number;

  readonly swordLength: number;
  readonly swordDamage: number;

  /** Movement speed for random wandering */
  readonly moveSpeed: number;

  /** Velocity for random movement */
  vx: number = 0;
  vy: number = 0;

  /** Sword rotation speed in radians per frame */
  swordRotationSpeed: number;

  /** Cooldown frames to prevent rapid repeated hits on same target */
  hitCooldown: number = 0;

  /** Short flash timer used to render a hit effect when this player is struck */
  hitFlashFrames: number = 0;

  /** Previous sword tip position (for continuous collision detection) */
  prevSwordTipX: number = 0;
  prevSwordTipY: number = 0;

  constructor(config: PlayerConfig) {
    this.id = config.id;
    this.countryName = config.countryName;
    this.flagImage = config.flagImage;
    this.x = config.x;
    this.y = config.y;
    this.radius = config.radius ?? 40;
    this.direction = Math.random() * Math.PI * 2;
    this.life = 100;
    this.swordLength = config.swordLength ?? 45;
    this.swordDamage = config.swordDamage ?? 2;
    this.moveSpeed = config.moveSpeed ?? 1.2;
    // Slightly randomized rotation speed and direction (clockwise / counter‑clockwise)
    const baseSpin = 0.06 + Math.random() * 0.04;
    const spinDirection = Math.random() < 0.5 ? -1 : 1; // -1 = clockwise, 1 = counter‑clockwise
    this.swordRotationSpeed = baseSpin * spinDirection;

    const tip = this.getSwordTip();
    this.prevSwordTipX = tip.x;
    this.prevSwordTipY = tip.y;
  }

  /** Whether this player is still alive (has life > 0) */
  get isAlive(): boolean {
    return this.life > 0;
  }

  /** Get sword tip position (endpoint of sword) in world coordinates */
  getSwordTip(): { x: number; y: number } {
    const tipX = this.x + Math.cos(this.direction) * this.swordLength;
    const tipY = this.y + Math.sin(this.direction) * this.swordLength;
    return { x: tipX, y: tipY };
  }

  /** Apply damage to this player (reduces life) */
  takeDamage(amount: number): void {
    this.life = Math.max(0, this.life - amount);
  }

  /** Update sword rotation and movement (called each frame) */
  update(speedFactor: number = 1): void {
    const f = speedFactor <= 0 ? 1 : speedFactor;

    // Store previous sword tip for continuous collision checks
    const prevTip = this.getSwordTip();
    this.prevSwordTipX = prevTip.x;
    this.prevSwordTipY = prevTip.y;

    this.direction += this.swordRotationSpeed * f;
    this.x += this.vx * f;
    this.y += this.vy * f;
    if (this.hitCooldown > 0) {
      this.hitCooldown--;
    }
  }

  /** Set random velocity for wandering within arena bounds */
  setRandomVelocity(): void {
    this.vx = (Math.random() - 0.5) * 2 * this.moveSpeed;
    this.vy = (Math.random() - 0.5) * 2 * this.moveSpeed;
  }

  /** Clamp position to arena bounds */
  clampToArena(minX: number, minY: number, maxX: number, maxY: number): void {
    this.x = Math.max(minX + this.radius, Math.min(maxX - this.radius, this.x));
    this.y = Math.max(minY + this.radius, Math.min(maxY - this.radius, this.y));
  }

  /** Bounce off walls by reversing velocity */
  bounceOffWalls(minX: number, minY: number, maxX: number, maxY: number): void {
    const r = this.radius;
    if (this.x <= minX + r) this.vx = Math.abs(this.vx);
    if (this.x >= maxX - r) this.vx = -Math.abs(this.vx);
    if (this.y <= minY + r) this.vy = Math.abs(this.vy);
    if (this.y >= maxY - r) this.vy = -Math.abs(this.vy);
  }
}
