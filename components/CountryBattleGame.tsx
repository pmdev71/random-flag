"use client";

/**
 * CountryBattleGame.tsx - Single-screen canvas game where countries battle with rotating swords.
 * Uses requestAnimationFrame for smooth animation and modular game engine.
 * Mobile responsive with settings in modal.
 */

import {
  useRef,
  useEffect,
  useCallback,
  useState,
} from "react";
import { GameEngine, type CountryInput } from "@/lib/game";
import { countries } from "@/components/country-select";
import { Modal } from "@/components/modal";
import { Settings } from "lucide-react";

// Fixed logical arena size (game coordinates)
const ARENA_WIDTH = 900;
const ARENA_HEIGHT = 600;
const ARENA_ASPECT = ARENA_WIDTH / ARENA_HEIGHT;

// Difficulty presets
type Difficulty = "easy" | "normal" | "hard";

type PlayerView = {
  id: string;
  x: number;
  y: number;
  radius: number;
  flag: string;
  countryName: string;
  life: number;
  hitFlashFrames: number;
  isAlive: boolean;
};

const DIFFICULTY_SETTINGS: Record<
  Difficulty,
  { speedMultiplier: number; damageMultiplier: number; hitCooldown: number }
> = {
  easy: { speedMultiplier: 0.7, damageMultiplier: 0.8, hitCooldown: 15 },
  normal: { speedMultiplier: 1, damageMultiplier: 1, hitCooldown: 10 },
  hard: { speedMultiplier: 1.4, damageMultiplier: 1.3, hitCooldown: 6 },
};

/** Map Country to CountryInput for GameEngine */
function toCountryInput(): CountryInput[] {
  return countries.map((c) => ({
    id: c.code,
    name: c.name,
    flag: c.flag,
  }));
}

/** Hit sound using public/sounds/knife-slice.wav */
let knifeSliceAudio: HTMLAudioElement | null = null;
function playHitSound(): void {
  try {
    if (!knifeSliceAudio) {
      knifeSliceAudio = new Audio("/sounds/knife-slice.wav");
    }
    // Clone the audio so multiple hits can overlap slightly
    const sound = knifeSliceAudio.cloneNode(true) as HTMLAudioElement;
    sound.currentTime = 0;
    void sound.play();
  } catch {
    // Audio not supported or blocked
  }
}

export function CountryBattleGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const rafRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [speed, setSpeed] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerViews, setPlayerViews] = useState<PlayerView[]>([]);

  /** Start or restart game */
  const startGame = useCallback(() => {
    const preset = DIFFICULTY_SETTINGS[difficulty];
    const engine = new GameEngine({
      arenaWidth: ARENA_WIDTH,
      arenaHeight: ARENA_HEIGHT,
      speedMultiplier: preset.speedMultiplier * speed,
      damageMultiplier: preset.damageMultiplier,
      hitCooldownFrames: preset.hitCooldown,
      velocityChangeInterval: 50,
    });
    engine.init(toCountryInput());
    engineRef.current = engine;
    setWinner(null);
    setIsPlaying(true);
    setSettingsOpen(false);
  }, [difficulty, speed]);

  /** Stop game loop */
  const stopGame = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  /** Game loop: tick engine -> render */
  const gameLoop = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // Total life before tick (to detect damage for hit sound)
    const totalLifeBefore = engine.playersList
      .filter((p) => p.isAlive)
      .reduce((s, p) => s + p.life, 0);

    // 1. Physics update
    // 2. Collision detection
    engine.tick();

    // Sync lightweight snapshot for DOM overlay flags (for better emoji rendering on Windows)
    setPlayerViews(
      engine.playersList.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        radius: p.radius,
        flag: p.flagImage,
        countryName: p.countryName,
        life: p.life,
        hitFlashFrames: p.hitFlashFrames,
        isAlive: p.isAlive,
      })),
    );

    // Play hit sound when any player takes damage
    if (soundEnabled) {
      const totalLifeAfter = engine.playersList
        .filter((p) => p.isAlive)
        .reduce((s, p) => s + p.life, 0);
      if (totalLifeAfter < totalLifeBefore) {
        playHitSound();
      }
    }

    // 3. Rendering
    render(ctx, engine);

    // Check winner
    const w = engine.winner;
    if (w) {
      setWinner(w.countryName);
      setIsPlaying(false);
      stopGame();
      return;
    }

    rafRef.current = requestAnimationFrame(gameLoop);
  }, [soundEnabled, stopGame]);

  /** Render all players and arena */
  const render = useCallback((ctx: CanvasRenderingContext2D, engine: GameEngine) => {
    const { minX, minY, maxX, maxY } = engine.arenaBounds;

    // Clear and draw dark arena
    ctx.fillStyle = "#0f0f14";
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    // Arena border
    ctx.strokeStyle = "#2a2a3a";
    ctx.lineWidth = 4;
    ctx.strokeRect(minX + 2, minY + 2, maxX - minX - 4, maxY - minY - 4);

    const players = engine.playersList;
    for (const player of players) {
      if (!player.isAlive) continue;

      const x = player.x;
      const y = player.y;
      const r = player.radius;

      // Health bar above player (scaled up with larger body)
      const barWidth = r * 2.8;
      const barHeight = 8;
      const barX = x - barWidth / 2;
      const barY = y - r - barHeight - 8;

      ctx.fillStyle = "#1a1a24";
      ctx.fillRect(barX, barY, barWidth, barHeight);
      ctx.fillStyle = player.life > 50 ? "#22c55e" : player.life > 25 ? "#eab308" : "#ef4444";
      ctx.fillRect(barX, barY, (barWidth * player.life) / 100, barHeight);
      ctx.strokeStyle = "#3f3f50";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barWidth, barHeight);

      // Player border around flag (flash orange briefly when hit)
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = player.hitFlashFrames > 0 ? "#fb923c" : "#e5e7eb";
      ctx.lineWidth = player.hitFlashFrames > 0 ? 3.4 : 2.6;
      ctx.stroke();

      // Sword / knife: real knife shape (handle + blade) instead of simple line
      const tip = player.getSwordTip();
      const angle = player.direction;
      const baseRadius = r + 6; // start knife just outside the body
      const baseX = x + Math.cos(angle) * baseRadius;
      const baseY = y + Math.sin(angle) * baseRadius;

      // Direction perpendicular to blade for width
      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);

      const bladeLength = player.swordLength;
      const bladeWidth = 9;
      const tipX = baseX + Math.cos(angle) * bladeLength;
      const tipY = baseY + Math.sin(angle) * bladeLength;

      // Blade polygon (slight taper towards the tip)
      const backLeftX = baseX + nx * bladeWidth;
      const backLeftY = baseY + ny * bladeWidth;
      const backRightX = baseX - nx * bladeWidth;
      const backRightY = baseY - ny * bladeWidth;
      const tipLeftX = tipX + nx * (bladeWidth * 0.4);
      const tipLeftY = tipY + ny * (bladeWidth * 0.4);
      const tipRightX = tipX - nx * (bladeWidth * 0.4);
      const tipRightY = tipY - ny * (bladeWidth * 0.4);

      // Blade fill (light steel)
      ctx.beginPath();
      ctx.moveTo(backLeftX, backLeftY);
      ctx.lineTo(tipLeftX, tipLeftY);
      ctx.lineTo(tipRightX, tipRightY);
      ctx.lineTo(backRightX, backRightY);
      ctx.closePath();
      ctx.fillStyle = "#e5e7eb";
      ctx.fill();

      // Blade edge (darker outline)
      ctx.strokeStyle = "#4b5563";
      ctx.lineWidth = 1.7;
      ctx.stroke();

      // Handle (short rounded rectangle inside the body side)
      const handleLength = 18;
      const handleWidth = 7;
      const handleBaseX = x + Math.cos(angle) * (r - 6);
      const handleBaseY = y + Math.sin(angle) * (r - 6);
      const handleEndX = handleBaseX + Math.cos(angle) * handleLength;
      const handleEndY = handleBaseY + Math.sin(angle) * handleLength;

      const hBackLeftX = handleBaseX + nx * handleWidth;
      const hBackLeftY = handleBaseY + ny * handleWidth;
      const hBackRightX = handleBaseX - nx * handleWidth;
      const hBackRightY = handleBaseY - ny * handleWidth;
      const hFrontLeftX = handleEndX + nx * handleWidth;
      const hFrontLeftY = handleEndY + ny * handleWidth;
      const hFrontRightX = handleEndX - nx * handleWidth;
      const hFrontRightY = handleEndY - ny * handleWidth;

      ctx.beginPath();
      ctx.moveTo(hBackLeftX, hBackLeftY);
      ctx.lineTo(hFrontLeftX, hFrontLeftY);
      ctx.lineTo(hFrontRightX, hFrontRightY);
      ctx.lineTo(hBackRightX, hBackRightY);
      ctx.closePath();
      ctx.fillStyle = "#020617";
      ctx.fill();
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Country name below (larger, to match bigger body)
      ctx.font = "16px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#e5e7eb";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const maxNameLen = 14;
      const name = player.countryName.length > maxNameLen
        ? player.countryName.slice(0, maxNameLen - 2) + "…"
        : player.countryName;
      ctx.fillText(name, x, y + r + 6);
    }
  }, []);

  // Start game loop when playing
  useEffect(() => {
    if (isPlaying && engineRef.current) {
      rafRef.current = requestAnimationFrame(gameLoop);
    }
    return () => stopGame();
  }, [isPlaying, gameLoop, stopGame]);

  return (
    <div className="h-dvh sm:min-h-screen flex flex-col bg-zinc-950 w-full max-w-full overflow-x-hidden">
      {/* Game section - canvas keeps perfect aspect ratio so bodies stay round */}
      <div className="flex-1 min-h-[180px] sm:min-h-0 flex flex-col sm:gap-2 sm:p-4 p-2 pt-3 sm:items-center overflow-hidden">
        <h1 className="text-base sm:text-2xl font-bold text-zinc-100 text-center shrink-0 mb-1 sm:mb-0">
          Country Sword Battle
        </h1>

        {/* Canvas arena - fixed aspect ratio (ARENA_WIDTH / ARENA_HEIGHT) so circles stay perfectly round */}
        <div
          className="relative w-full sm:max-w-[900px] sm:mx-auto rounded-lg border-2 border-zinc-700 overflow-hidden bg-zinc-900"
          style={{ aspectRatio: ARENA_ASPECT }}
        >
          <canvas
            ref={canvasRef}
            width={ARENA_WIDTH}
            height={ARENA_HEIGHT}
            className="block w-full h-full"
            style={{ background: "#0f0f14" }}
          />

          {/* DOM overlay for flags so emoji render like the main page (works on Windows too) */}
          <div className="pointer-events-none absolute inset-0">
            {playerViews
              .filter((p) => p.isAlive)
              .map((p) => {
                const sizeW = (p.radius * 2 * 100) / ARENA_WIDTH;
                const sizeH = (p.radius * 2 * 100) / ARENA_HEIGHT;
                const left = ((p.x - p.radius) * 100) / ARENA_WIDTH;
                const top = ((p.y - p.radius) * 100) / ARENA_HEIGHT;
                return (
                  <div
                    key={p.id}
                    className="absolute flex items-center justify-center rounded-full bg-black/90 text-white text-xl sm:text-2xl"
                    style={{
                      width: `${sizeW}%`,
                      height: `${sizeH}%`,
                      left: `${left}%`,
                      top: `${top}%`,
                    }}
                  >
                    <span className="leading-none">{p.flag}</span>
                  </div>
                );
              })}
          </div>

          {/* Winner banner overlay */}
          {winner && (
            <div
              className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/70"
              style={{ pointerEvents: "none" }}
            >
              <div className="bg-zinc-800 border-2 border-amber-500 rounded-xl px-6 py-4 sm:px-8 sm:py-6 text-center shadow-2xl mx-4">
                <p className="text-amber-400 text-xs sm:text-sm font-medium uppercase tracking-wider">
                  Winner
                </p>
                <p className="text-xl sm:text-3xl font-bold text-white mt-1 truncate max-w-[80vw]">{winner}</p>
                <p className="text-zinc-400 text-xs sm:text-sm mt-2">Last country standing!</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar: Start + Settings - fixed at bottom on mobile */}
      <div
        className="shrink-0 flex items-center justify-center gap-3 w-full p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 bg-zinc-950 border-t border-zinc-800/50 sm:border-t-0"
      >
        <button
          onClick={startGame}
          className="flex-1 max-w-[200px] sm:flex-none bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white px-6 py-3 rounded-xl font-medium text-base min-h-[48px] touch-manipulation"
        >
          {winner ? "Play Again" : isPlaying ? "Restart" : "Start Game"}
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-xl p-3 bg-zinc-800 border border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:text-white active:bg-zinc-600 transition-colors touch-manipulation min-h-[48px] min-w-[48px]"
          aria-label="Settings"
        >
          <Settings className="h-6 w-6" />
        </button>
      </div>

      {/* Settings Modal */}
      <Modal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Game Settings"
        size="sm"
      >
        <div className="flex flex-col gap-5">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              className="w-full bg-zinc-800 text-zinc-200 px-3 py-2 rounded-lg border border-zinc-600"
            >
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Speed: {speed.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
              className="rounded accent-emerald-500"
            />
            <span className="text-sm text-zinc-300">Sound effects</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
