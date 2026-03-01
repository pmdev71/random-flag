/**
 * GameEngine.ts - Core game logic: physics, collision, state management.
 * Separates game loop into: physics update -> collision detection -> state.
 */

import { Player } from "./Player";
import { swordHitsPlayer } from "./collision";

export interface GameSettings {
  /** Arena width in pixels */
  arenaWidth: number;
  /** Arena height in pixels */
  arenaHeight: number;
  /** Base move speed multiplier (affects random wandering) */
  speedMultiplier?: number;
  /** Sword damage multiplier */
  damageMultiplier?: number;
  /** How often to update random velocity (every N frames) */
  velocityChangeInterval?: number;
  /** Hit cooldown frames (prevents instant death) */
  hitCooldownFrames?: number;
}

export interface CountryInput {
  id: string;
  name: string;
  flag: string;
}

export class GameEngine {
  private players: Player[] = [];
  private arenaMinX = 0;
  private arenaMinY = 0;
  private arenaMaxX = 800;
  private arenaMaxY = 600;
  private velocityChangeInterval = 60;
  private frameCount = 0;
  private hitCooldownFrames = 10;
  private speedMultiplier = 1;
  private damageMultiplier = 1;
  private _winner: Player | null = null;

  constructor(settings: GameSettings) {
    this.arenaMinX = 0;
    this.arenaMinY = 0;
    this.arenaMaxX = settings.arenaWidth;
    this.arenaMaxY = settings.arenaHeight;
    this.speedMultiplier = settings.speedMultiplier ?? 1;
    this.damageMultiplier = settings.damageMultiplier ?? 1;
    this.velocityChangeInterval = settings.velocityChangeInterval ?? 60;
    this.hitCooldownFrames = settings.hitCooldownFrames ?? 10;
  }

  /** Initialize game with given countries */
  init(countries: CountryInput[]): void {
    this.players = [];
    this._winner = null;
    this.frameCount = 0;

    const count = Math.min(countries.length, 20); // Cap at 20 players for performance
    const selected = this.pickRandomCountries(countries, count);
    const positions = this.generateSpawnPositions(count);

    selected.forEach((c, i) => {
      const moveSpeed = (0.8 + Math.random() * 0.8) * this.speedMultiplier;
      const player = new Player({
        id: c.id,
        countryName: c.name,
        flagImage: c.flag,
        x: positions[i].x,
        y: positions[i].y,
        // Slightly longer knives for bigger bodies
        swordLength: 55 + Math.random() * 20,
        swordDamage: (1.5 + Math.random() * 2) * this.damageMultiplier,
        moveSpeed,
      });
      // Give each player an initial random movement direction once at start.
      player.setRandomVelocity();
      this.players.push(player);
    });
  }

  private pickRandomCountries(countries: CountryInput[], count: number): CountryInput[] {
    const shuffled = [...countries].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  private generateSpawnPositions(count: number): { x: number; y: number }[] {
    const margin = 80;
    const positions: { x: number; y: number }[] = [];
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellW = (this.arenaMaxX - margin * 2) / cols;
    const cellH = (this.arenaMaxY - margin * 2) / rows;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const jitter = 0.3;
      const x =
        margin + col * cellW + cellW / 2 + (Math.random() - 0.5) * cellW * jitter;
      const y =
        margin + row * cellH + cellH / 2 + (Math.random() - 0.5) * cellH * jitter;
      positions.push({ x: Math.max(margin, Math.min(this.arenaMaxX - margin, x)), y: Math.max(margin, Math.min(this.arenaMaxY - margin, y)) });
    }
    return positions;
  }

  /** Physics update: move players, rotate swords, apply bounds */
  physicsUpdate(): void {
    this.frameCount++;

    // When only a few players remain, dramatically speed up movement and sword spin.
    const aliveCount = this.alivePlayers.length;
    const speedFactor = aliveCount <= 5 ? 20 : 1;

    for (const player of this.players) {
      if (!player.isAlive) continue;

      player.update(speedFactor);
      player.clampToArena(
        this.arenaMinX,
        this.arenaMinY,
        this.arenaMaxX,
        this.arenaMaxY
      );
      player.bounceOffWalls(
        this.arenaMinX,
        this.arenaMinY,
        this.arenaMaxX,
        this.arenaMaxY
      );

      // Fade out hit flash effect over time
      if (player.hitFlashFrames > 0) {
        player.hitFlashFrames -= 1;
      }
    }
  }

  /** Collision detection: check sword hits and apply damage */
  collisionUpdate(): void {
    const damage = this.damageMultiplier;

    for (const attacker of this.players) {
      if (!attacker.isAlive) continue;

      for (const target of this.players) {
        if (target.id === attacker.id) continue;
        if (!target.isAlive) continue;

        if (swordHitsPlayer(attacker, target)) {
          const dmg = attacker.swordDamage * damage;
          target.takeDamage(dmg);
          attacker.hitCooldown = this.hitCooldownFrames;
          // Trigger a short visual flash on the struck player
          target.hitFlashFrames = this.hitCooldownFrames;
        }
      }
    }
  }

  /** Update winner: last remaining alive */
  updateWinner(): void {
    const alive = this.players.filter((p) => p.isAlive);
    if (alive.length === 1) {
      this._winner = alive[0];
    }
  }

  /** Full game tick: physics -> collision -> winner check */
  tick(): void {
    this.physicsUpdate();
    this.collisionUpdate();
    this.updateWinner();
  }

  get playersList(): Player[] {
    return this.players;
  }

  get alivePlayers(): Player[] {
    return this.players.filter((p) => p.isAlive);
  }

  get winner(): Player | null {
    return this._winner;
  }

  get isGameOver(): boolean {
    return this._winner !== null || this.alivePlayers.length <= 1;
  }

  get arenaBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    return {
      minX: this.arenaMinX,
      minY: this.arenaMinY,
      maxX: this.arenaMaxX,
      maxY: this.arenaMaxY,
    };
  }
}
