"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { countries, type Country } from "@/components/country-select";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import {
  Play,
  RotateCcw,
  Zap,
  Users,
  Sparkles,
  Settings,
} from "lucide-react";
import { ToastContainer, useToast } from "@/components/toast";

const DEFAULT_GAP_ANGLE = 35; // Default gap size in degrees
const LOGICAL_R = 1;
const BASE_FLAG_SIZE = 36;
const BASE_SPEED = 0.00035;

// Calculate flag size based on number of flags
function getFlagSize(flagCount: number): number {
  // Base size for small counts, scale down as count increases
  if (flagCount <= 10) return BASE_FLAG_SIZE;
  if (flagCount <= 20) return BASE_FLAG_SIZE * 0.75; // 27px
  if (flagCount <= 50) return BASE_FLAG_SIZE * 0.6; // 21.6px
  if (flagCount <= 100) return BASE_FLAG_SIZE * 0.45; // 16.2px
  // For 100+ flags, use even smaller size
  return BASE_FLAG_SIZE * 0.35; // 12.6px
}

type GameState = "idle" | "playing" | "finished";

interface BouncingFlag {
  country: Country;
  x: number;
  y: number;
  vx: number;
  vy: number;
  eliminated: boolean;
  eliminatedOrder?: number;
  falling?: boolean;
  fallY?: number;
  fallX?: number;
  fallOpacity?: number;
  fallStartTime?: number;
  stacked?: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isInGap(angle: number, gapRotation: number, gapAngleDegrees: number): boolean {
  // Check if angle is within the gap, accounting for gap rotation
  const gapAngle = (gapAngleDegrees * Math.PI) / 180;
  const relativeAngle = angle - gapRotation;
  // Normalize to [-PI, PI]
  let normalized = ((relativeAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (normalized > Math.PI) normalized -= 2 * Math.PI;
  return Math.abs(normalized) <= gapAngle / 2;
}

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState>("idle");
  const [flags, setFlags] = useState<BouncingFlag[]>([]);
  const [winner, setWinner] = useState<Country | null>(null);
  const [eliminatedList, setEliminatedList] = useState<Country[]>([]);
  const [speedMult, setSpeedMult] = useState(1);
  const [flagCount, setFlagCount] = useState(8);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [winnerModalOpen, setWinnerModalOpen] = useState(false);
  const [gapRotation, setGapRotation] = useState(0);
  const [gapRotationEnabled, setGapRotationEnabled] = useState(true);
  const [gapRotationSpeed, setGapRotationSpeed] = useState(1); // 0.5x, 1x, 1.5x, 2x
  const [gapSize, setGapSize] = useState(DEFAULT_GAP_ANGLE); // Gap size in degrees
  const [loopEnabled, setLoopEnabled] = useState(false); // Auto-start next round
  const eliminatedOrderRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const gapRotationRef = useRef(0);
  const eliminatedSetRef = useRef<Set<string>>(new Set());
  const gapRotationDirectionRef = useRef(1); // 1 for clockwise, -1 for counter-clockwise
  const gapDynamicSpeedRef = useRef(1); // Dynamic speed multiplier
  const lastDirectionChangeRef = useRef(0); // Track when direction/speed last changed
  const toast = useToast();

  const cx = 0.5;
  const cy = 0.5;
  const radius = 0.42;
  const scale = 1; // Scale factor: logical coordinates map 1:1 to visual percentage (radius 0.42 = 42% visual)

  const startGame = useCallback(() => {
    // Calculate flag size based on flag count
    const currentFlagSize = getFlagSize(flagCount);
    
    // Calculate maximum flag center distance accounting for flag size
    const containerEl = containerRef.current;
    const containerWidth = containerEl ? containerEl.offsetWidth : 0;
    const containerHeight = containerEl ? containerEl.offsetHeight : 0;
    const containerSize = Math.min(containerWidth, containerHeight) || containerWidth;
    
    // If container not measured yet, use a safe default (assume 400px container)
    const safeContainerSize = containerSize > 0 ? containerSize : 400;
    const flagSizeLogical = currentFlagSize / safeContainerSize;
    const flagRadiusLogical = flagSizeLogical / 2;
    const maxFlagCenterDistance = Math.max(0.05, radius - flagRadiusLogical);
    
    const shuffled = shuffle(countries).slice(0, flagCount);
    const initial: BouncingFlag[] = shuffled.map((country) => {
      let x: number, y: number;
      // Place flags at 85% of max allowed distance to keep them well inside
      const placementRadius = 0.85 * maxFlagCenterDistance;
      do {
        x = (Math.random() * 2 - 1) * placementRadius;
        y = (Math.random() * 2 - 1) * placementRadius;
      } while (x * x + y * y > placementRadius * placementRadius);
      const angle = Math.random() * 2 * Math.PI;
      const speed = 0.15 + Math.random() * 0.1;
      return {
        country,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        eliminated: false,
      };
    });
    eliminatedOrderRef.current = 0;
    // Start gap from random position
    const randomStartAngle = Math.random() * 2 * Math.PI;
    gapRotationRef.current = randomStartAngle;
    eliminatedSetRef.current = new Set();
    // Reset rotation direction and speed
    gapRotationDirectionRef.current = Math.random() > 0.5 ? 1 : -1; // Random initial direction
    gapDynamicSpeedRef.current = 0.5 + Math.random() * 1.5; // Random speed between 0.5x and 2x
    lastDirectionChangeRef.current = performance.now();
    setFlags(initial);
    setEliminatedList([]);
    setWinner(null);
    setGapRotation(randomStartAngle);
    setGameState("playing");
    setSettingsModalOpen(false);
  }, [flagCount]);

  const resetGame = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setGameState("idle");
    setFlags([]);
    setWinner(null);
    setEliminatedList([]);
    eliminatedSetRef.current = new Set();
  }, []);


  // Game loop
  useEffect(() => {
    if (gameState !== "playing" || flags.length === 0) return;

    let lastTime = performance.now();
    lastTimeRef.current = lastTime;
    const BASE_ROTATION_SPEED = 0.0003; // radians per millisecond
    let nextDirectionChangeTime = lastTime + 2000 + Math.random() * 3000; // First change after 2-5 seconds

    const loop = (time: number) => {
      const dt = Math.min((time - lastTime) * speedMult, 50);
      lastTime = time;
      lastTimeRef.current = time;

      // Rotate the gap continuously if enabled
      if (gapRotationEnabled) {
        // Randomly change direction and speed at intervals
        if (time >= nextDirectionChangeTime) {
          // Randomly change direction (50% chance)
          if (Math.random() > 0.5) {
            gapRotationDirectionRef.current *= -1;
          }
          // Randomly change speed multiplier (between 0.3x and 2.5x)
          gapDynamicSpeedRef.current = 0.3 + Math.random() * 2.2;
          // Schedule next change (2-5 seconds from now)
          nextDirectionChangeTime = time + 2000 + Math.random() * 3000;
        }

        const rotationSpeed = BASE_ROTATION_SPEED * gapRotationSpeed * gapDynamicSpeedRef.current * gapRotationDirectionRef.current;
        gapRotationRef.current = (gapRotationRef.current + dt * rotationSpeed + 2 * Math.PI) % (2 * Math.PI);
        setGapRotation(gapRotationRef.current);
      }
      

      setFlags((prev) => {
        const containerEl = containerRef.current;
        const containerHeight = containerEl ? containerEl.offsetHeight : 0;
        const FALL_SPEED = 0.3; // pixels per millisecond
        const FADE_SPEED = 0.002; // opacity per millisecond

        // Calculate stack bottom position - above the button area
        const screenHeight = window.innerHeight || containerHeight;
        // Button area is fixed at bottom with p-4 (16px padding) and button height (~48px)
        // Total button area height is approximately 80px on mobile, less on desktop
        const isMobile = window.innerWidth < 768;
        const buttonAreaHeight = isMobile ? 80 : 0; // Button area only on mobile (fixed bottom)
        const stackBottom = screenHeight - buttonAreaHeight;

        // Update falling flags - let them stack at the bottom
        const updated = prev.map((f) => {
          // Skip eliminated flags that aren't falling
          if (f.eliminated && !f.falling) {
            return f;
          }
          
          if (f.falling && f.fallY !== undefined && f.fallOpacity !== undefined) {
            // If already stacked, keep position stable (don't recalculate)
            if (f.stacked) {
              return {
                ...f,
                fallOpacity: Math.max(0.7, f.fallOpacity), // Maintain opacity
              };
            }
            
            // Calculate new fall position
            const newFallY = f.fallY + dt * FALL_SPEED;
            const containerWidth = containerEl ? containerEl.offsetWidth : 0;
            const containerLeft = containerEl ? containerEl.getBoundingClientRect().left + window.scrollX : 0;
            
            // Check if this flag has reached the bottom
            if (newFallY >= stackBottom - flagSize) {
              // Count how many flags have already reached the bottom (for row arrangement)
              // Only count flags that are already stacked (have stacked: true)
              const alreadyStacked = prev.filter(
                (other) => 
                  other.stacked === true &&
                  other.eliminatedOrder !== undefined &&
                  other.eliminatedOrder < (f.eliminatedOrder || Infinity)
              ).length;
              
              // Center all flags horizontally at the bottom of the screen
              const spacing = flagSize * 1.1; // Gap between flag centers (10% more than flag size for visible gap)
              const screenWidth = window.innerWidth || containerWidth;
              const screenCenterX = screenWidth / 2;
              
              // Calculate max flags per row based on available screen space
              const availableSpacePerSide = (screenWidth / 2) - (flagSize / 2);
              const maxFlagsPerSide = Math.floor(availableSpacePerSide / spacing);
              const maxFlagsPerRow = Math.max(1, maxFlagsPerSide * 2 + 1); // +1 for center flag
              const rowIndex = Math.floor(alreadyStacked / maxFlagsPerRow); // Which row (0 = bottom)
              const positionInRow = alreadyStacked % maxFlagsPerRow; // Position within current row
              
              // Calculate Y position (bottom row is at stackBottom, rows go up)
              const rowY = stackBottom - flagSize - (rowIndex * flagSize * 0.9);
              
              // Calculate X position - centered arrangement
              // Since we use translate(-50%, -50%), the left position represents the center of the element
              let rowX: number;
              if (positionInRow === 0) {
                // First flag in row: center
                rowX = screenCenterX;
              } else {
                // Arrange flags centered: alternate left and right from center
                const isRight = positionInRow % 2 === 1;
                const step = Math.floor((positionInRow + 1) / 2); // Calculate step: 1, 1, 2, 2, 3, 3, ...
                const offset = isRight ? step * spacing : -step * spacing;
                rowX = screenCenterX + offset;
                
                // Ensure flag stays within screen boundaries (with padding)
                const padding = flagSize / 2;
                rowX = Math.max(padding, Math.min(screenWidth - padding, rowX));
              }
              
              // Keep opacity visible (don't fade completely)
              const finalOpacity = Math.max(0.7, f.fallOpacity);
              
              return {
                ...f,
                fallY: rowY,
                fallX: rowX,
                fallOpacity: finalOpacity,
                stacked: true, // Mark as stacked - position is now fixed
              };
            }
            
            // Still falling - continue animation with slower fade
            const newOpacity = Math.max(0.8, f.fallOpacity - dt * FADE_SPEED * 0.3);
            return {
              ...f,
              fallY: newFallY,
              fallOpacity: newOpacity,
            };
          }
          return f;
        });

        // Process new eliminations first
        // Visual circle: radius = 0.42 (42% of container, matches SVG r="42" in viewBox 0-100)
        // Check collision at the actual visual radius, then clamp flag center position
        // so flag edge aligns with the visual circle boundary
        // IMPORTANT: Use the smaller dimension to ensure circular boundary (not square)
        const containerWidthForCollision = containerEl ? containerEl.offsetWidth : 0;
        const containerHeightForCollision = containerEl ? containerEl.offsetHeight : 0;
        // Use minimum dimension to maintain circular shape (prevents square boundaries)
        const containerSize = Math.min(containerWidthForCollision, containerHeightForCollision) || Math.max(containerWidthForCollision, containerHeightForCollision) || 1;
        
        // Convert flag size from pixels to logical coordinates
        // flagSize (px) / containerSize (px) = flagSize in logical units (as fraction of container)
        const flagSizeLogical = flagSize / containerSize;
        const flagRadiusLogical = flagSizeLogical / 2; // Half flag size = radius from center to edge
        
        // Maximum allowed distance for flag center: visual radius minus flag radius
        // This ensures flag edge stays exactly at the visual circle boundary
        const maxFlagCenterDistance = Math.max(0.05, radius - flagRadiusLogical);
        
        const next = updated.map((f) => {
          if (f.eliminated || f.falling) return f;
          
          // Calculate new position
          const prevX = f.x;
          const prevY = f.y;
          const prevDist = Math.sqrt(prevX * prevX + prevY * prevY);
          const velocityMagnitude = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
          const moveDistance = velocityMagnitude * dt * BASE_SPEED * 60;
          
          let x = f.x + f.vx * dt * BASE_SPEED * 60;
          let y = f.y + f.vy * dt * BASE_SPEED * 60;
          
          // Calculate circular distance from center (always use circular boundary)
          let dist = Math.sqrt(x * x + y * y);

          // Continuous collision detection: check if flag crossed maxFlagCenterDistance during movement
          // This handles cases where flags move too fast and skip past the boundary
          // We check maxFlagCenterDistance (not radius) so flag edge stays at visual boundary
          const wasInsideMax = prevDist <= maxFlagCenterDistance;
          const isOutsideMax = dist > maxFlagCenterDistance;
          
          // Also check if flag crossed radius (for gap exit detection)
          const wasInsideRadius = prevDist <= radius;
          const isOutsideRadius = dist > radius;
          
          // If flag crossed radius, check for gap exit first (before clamping)
          if (wasInsideRadius && isOutsideRadius) {
            // Find intersection point at radius to check gap
            const dx = x - prevX;
            const dy = y - prevY;
            const segmentLength = Math.sqrt(dx * dx + dy * dy);
            
            if (segmentLength > 0) {
              // Find intersection point at radius
              let tLow = 0;
              let tHigh = 1;
              let t = 0.5;
              
              for (let i = 0; i < 15; i++) {
                const testX = prevX + t * dx;
                const testY = prevY + t * dy;
                const testDist = Math.sqrt(testX * testX + testY * testY);
                
                if (Math.abs(testDist - radius) < 0.0001) break;
                
                if (testDist < radius) {
                  tLow = t;
                } else {
                  tHigh = t;
                }
                t = (tLow + tHigh) / 2;
              }
              
              // Check gap at intersection point
              const intersectX = prevX + t * dx;
              const intersectY = prevY + t * dy;
              const intersectAngle = Math.atan2(intersectY, intersectX);
              const currentGapRotation = gapRotationEnabled ? gapRotationRef.current : 0;
              
              // If passing through gap, allow exit (don't clamp)
              if (isInGap(intersectAngle, currentGapRotation, gapSize)) {
                // Flag is exiting through gap - keep the new position
                // The gap check below will handle elimination
              } else {
                // Flag hit wall - clamp to maxFlagCenterDistance (not radius)
                // Find intersection at maxFlagCenterDistance instead
                tLow = 0;
                tHigh = 1;
                t = 0.5;
                
                for (let i = 0; i < 15; i++) {
                  const testX = prevX + t * dx;
                  const testY = prevY + t * dy;
                  const testDist = Math.sqrt(testX * testX + testY * testY);
                  
                  if (Math.abs(testDist - maxFlagCenterDistance) < 0.0001) break;
                  
                  if (testDist < maxFlagCenterDistance) {
                    tLow = t;
                  } else {
                    tHigh = t;
                  }
                  t = (tLow + tHigh) / 2;
                }
                
                // Clamp to maxFlagCenterDistance so flag edge stays at visual boundary
                x = prevX + t * dx;
                y = prevY + t * dy;
                dist = Math.sqrt(x * x + y * y);
              }
            }
          } else if (wasInsideMax && isOutsideMax) {
            // Flag crossed maxFlagCenterDistance but not radius yet - clamp immediately
            const dx = x - prevX;
            const dy = y - prevY;
            const segmentLength = Math.sqrt(dx * dx + dy * dy);
            
            if (segmentLength > 0) {
              let tLow = 0;
              let tHigh = 1;
              let t = 0.5;
              
              for (let i = 0; i < 15; i++) {
                const testX = prevX + t * dx;
                const testY = prevY + t * dy;
                const testDist = Math.sqrt(testX * testX + testY * testY);
                
                if (Math.abs(testDist - maxFlagCenterDistance) < 0.0001) break;
                
                if (testDist < maxFlagCenterDistance) {
                  tLow = t;
                } else {
                  tHigh = t;
                }
                t = (tLow + tHigh) / 2;
              }
              
              x = prevX + t * dx;
              y = prevY + t * dy;
              dist = Math.sqrt(x * x + y * y);
            }
          }

          // Check if flag center has crossed the visual circle boundary (radius 0.42)
          // Use circular distance check - this ensures circular bouncing area
          if (dist > radius) {
            const angle = Math.atan2(y, x);
            const currentGapRotation = gapRotationEnabled ? gapRotationRef.current : 0;
            
            // Check if flag is passing through the gap
            if (isInGap(angle, currentGapRotation, gapSize)) {
              // Flag exits through gap - eliminate it
              if (!eliminatedSetRef.current.has(f.country.code)) {
                eliminatedOrderRef.current += 1;
                eliminatedSetRef.current.add(f.country.code);
                setEliminatedList((list) => [...list, f.country]);
              }
              // Convert logical position to pixel position for fall animation
              const fallStartX = containerWidthForCollision * (cx + x * scale);
              const fallStartY = containerHeightForCollision * (cy + y * scale);
              return {
                ...f,
                eliminated: true,
                eliminatedOrder: eliminatedOrderRef.current,
                falling: true,
                x: x, // Keep the exit position
                y: y, // Keep the exit position
                fallY: fallStartY,
                fallOpacity: 1,
                fallStartTime: performance.now(),
              };
            }
            
            // Flag hit the circular wall (not in gap) - bounce back
            // Calculate normal vector pointing outward from circle center
            // Normalize the position vector to get the normal
            const nx = x / dist; // Normalized x (points from center to flag)
            const ny = y / dist; // Normalized y (points from center to flag)
            
            // Clamp flag center position to circular boundary
            // Use maxFlagCenterDistance to ensure flag edge stays at visual circle
            const clampedX = nx * maxFlagCenterDistance;
            const clampedY = ny * maxFlagCenterDistance;
            const clampedDist = Math.sqrt(clampedX * clampedX + clampedY * clampedY);
            
            // Reflect velocity off circular wall: v' = v - 2(v·n)n
            // This ensures proper circular bounce
            const dot = f.vx * nx + f.vy * ny;
            let vx = f.vx - 2 * dot * nx;
            let vy = f.vy - 2 * dot * ny;
            
            x = clampedX;
            y = clampedY;
            return { ...f, x, y, vx, vy };
          }
          
          // Safety check: ensure flag never exceeds max allowed circular distance
          // This handles edge cases and ensures circular boundary
          if (dist > maxFlagCenterDistance) {
            // Normalize position vector to get direction from center
            const nx = x / dist;
            const ny = y / dist;
            
            // Clamp to circular boundary
            x = nx * maxFlagCenterDistance;
            y = ny * maxFlagCenterDistance;
            
            // If flag was moving outward, bounce it back (circular bounce)
            const dot = f.vx * nx + f.vy * ny;
            if (dot > 0) {
              // Reflect velocity off circular wall
              let vx = f.vx - 2 * dot * nx;
              let vy = f.vy - 2 * dot * ny;
              return { ...f, x, y, vx, vy };
            }
            return { ...f, x, y };
          }
          
          return { ...f, x, y };
        });

        // Count active flags (not eliminated, not falling) after processing eliminations
        const active = next.filter((f) => !f.eliminated && !f.falling);
        const prevActiveCount = prev.filter((f) => !f.eliminated && !f.falling).length;
        
        // Show modal when 2nd-to-last flag is eliminated (when going from 2 to 1)
        if (active.length === 1 && prevActiveCount === 2) {
          setWinner(active[0].country);
          setWinnerModalOpen(true);
          setGameState("finished");
          return next;
        }
        
        // Also handle edge case when game ends with 0 flags
        if (active.length === 0) {
          setGameState("finished");
          return next;
        }

        return next;
      });

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [gameState, speedMult, flags.length, gapRotationEnabled, gapRotationSpeed, gapSize]);

  // Calculate dynamic flag size based on flag count
  const flagSize = getFlagSize(flagCount);
  
  // Calculate emoji font size based on flag size (roughly 60% of flag size)
  const emojiSize = Math.max(12, Math.floor(flagSize * 0.6));

  // Position as percentage so layout is correct before measure
  const leftPct = (x: number) => (cx + x * scale) * 100;
  const topPct = (y: number) => (cy + y * scale) * 100;

  // Generate preview flags when in idle state based on flagCount
  useEffect(() => {
    if (gameState === "idle") {
      const containerEl = containerRef.current;
      const containerWidth = containerEl ? containerEl.offsetWidth : 0;
      const containerHeight = containerEl ? containerEl.offsetHeight : 0;
      const containerSize = Math.min(containerWidth, containerHeight) || containerWidth;
      
      // Calculate maximum flag center distance accounting for flag size
      // If container not measured yet, use a safe default (assume 400px container)
      const safeContainerSize = containerSize > 0 ? containerSize : 400;
      const flagSizeLogical = flagSize / safeContainerSize;
      const flagRadiusLogical = flagSizeLogical / 2;
      const maxFlagCenterDistance = Math.max(0.05, radius - flagRadiusLogical);
      
      const shuffled = shuffle(countries).slice(0, flagCount);
      const previewFlags: BouncingFlag[] = shuffled.map((country) => {
        let x: number, y: number;
        // Place flags at 85% of max allowed distance to keep them well inside
        const placementRadius = 0.85 * maxFlagCenterDistance;
        do {
          x = (Math.random() * 2 - 1) * placementRadius;
          y = (Math.random() * 2 - 1) * placementRadius;
        } while (x * x + y * y > placementRadius * placementRadius);
        return {
          country,
          x,
          y,
          vx: 0,
          vy: 0,
          eliminated: false,
        };
      });
      setFlags(previewFlags);
      // Set gap rotation for preview (random position)
      const randomStartAngle = Math.random() * 2 * Math.PI;
      gapRotationRef.current = randomStartAngle;
      // Initialize rotation direction and speed for preview
      gapRotationDirectionRef.current = Math.random() > 0.5 ? 1 : -1;
      gapDynamicSpeedRef.current = 0.5 + Math.random() * 1.5;
      lastDirectionChangeRef.current = performance.now();
      setGapRotation(randomStartAngle);
    }
  }, [flagCount, gameState, flagSize]);

  // Open winner modal when winner is set
  useEffect(() => {
    if (winner && gameState === "finished") {
      setWinnerModalOpen(true);
    }
  }, [winner, gameState]);

  // Auto-start next round if loop is enabled
  useEffect(() => {
    if (gameState === "finished" && loopEnabled && winner) {
      const timer = setTimeout(() => {
        // Close winner modal and start new round
        setWinnerModalOpen(false);
        // Small delay to ensure modal closes smoothly
        setTimeout(() => {
          startGame();
        }, 300);
      }, 5000); // Wait 5 seconds before starting next round (show winner for 5s)
      
      return () => clearTimeout(timer);
    }
  }, [gameState, loopEnabled, winner, startGame]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-50 transition-colors dark:bg-gray-950">
      {/* Settings button - floating */}
      <button
        onClick={() => setSettingsModalOpen(true)}
        className="fixed top-4 right-4 z-50 rounded-lg p-2 bg-white/90 dark:bg-gray-800/90 shadow-lg border border-gray-200 dark:border-gray-700 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
        aria-label="Open settings"
      >
        <Settings className="h-5 w-5" />
      </button>

      {/* Settings Modal */}
      <Modal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        title="Game Settings"
        size="md"
      >
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Number of flags
            </span>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="2"
                max="200"
                value={flagCount}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 2;
                  const clampedValue = Math.max(2, Math.min(200, value));
                  setFlagCount(clampedValue);
                }}
                className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500"
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                {[4, 8, 12, 20, 50, 100].map((n) => (
                  <button
                    key={n}
                    onClick={() => setFlagCount(n)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      flagCount === n
                        ? "bg-blue-600 text-white dark:bg-blue-500"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Speed
            </span>
            <div className="flex items-center gap-2">
              {[0.75, 1, 1.5, 2].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeedMult(s)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    speedMult === s
                      ? "bg-blue-600 text-white dark:bg-blue-500"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Rotating gap
            </span>
            <button
              onClick={() => setGapRotationEnabled(!gapRotationEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                gapRotationEnabled
                  ? "bg-blue-600 dark:bg-blue-500"
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  gapRotationEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {gapRotationEnabled && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Gap rotation speed
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {[0.5, 1, 1.5, 2, 2.5, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    onClick={() => setGapRotationSpeed(s)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      gapRotationSpeed === s
                        ? "bg-blue-600 text-white dark:bg-blue-500"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Gap size (degrees)
            </span>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="10"
                max="90"
                value={gapSize}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 10;
                  const clampedValue = Math.max(10, Math.min(90, value));
                  setGapSize(clampedValue);
                }}
                className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500"
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                {[20, 30, 35, 45, 60].map((s) => (
                  <button
                    key={s}
                    onClick={() => setGapSize(s)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      gapSize === s
                        ? "bg-blue-600 text-white dark:bg-blue-500"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    }`}
                  >
                    {s}°
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Auto loop rounds
            </span>
            <button
              onClick={() => setLoopEnabled(!loopEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                loopEnabled
                  ? "bg-blue-600 dark:bg-blue-500"
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  loopEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      </Modal>

      {/* Game arena */}
      <div className="relative flex flex-col items-center justify-center w-full h-full overflow-hidden pb-20 md:pb-0">
        <div className="relative w-full h-full max-w-full max-h-full overflow-hidden flex items-center justify-center">
          <div
            ref={containerRef}
            className="relative w-full h-full max-w-[min(100vw,100vh)] max-h-[min(100vw,100vh)] aspect-square rounded-3xl border-0 bg-gray-50/50 dark:bg-gray-800/50 overflow-hidden"
          >
            {/* Bouncing area marker - shows where flags bounce (static, doesn't rotate) */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Circle background */}
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="rgba(59, 130, 246, 0.06)"
              />
              {/* Bouncing boundary marker - dashed circle showing bounce area */}
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="rgba(59, 130, 246, 0.4)"
                strokeWidth="0.6"
                strokeDasharray="3 3"
                opacity="0.7"
              />
            </svg>
            
            {/* Rotating circle border with gap */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
              style={{
                transform: `rotate(${(gapRotation * 180) / Math.PI}deg)`,
                transition: gapRotationEnabled ? "none" : "transform 0.1s linear",
              }}
            >
              {/* Circle border with gap */}
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="rgba(59, 130, 246, 0.9)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={100}
                strokeDasharray={`${100 - (gapSize / 360) * 100} ${(gapSize / 360) * 100}`}
                strokeDashoffset="0"
                style={{
                  transform: "rotate(-90deg)",
                  transformOrigin: "50% 50%",
                }}
              />
            </svg>
            {flags
              .filter((f) => !f.eliminated && !f.falling)
              .map((f) => (
                <motion.div
                  key={f.country.code}
                  className="absolute flex items-center justify-center rounded-lg bg-white/90 dark:bg-gray-800/90 shadow-md border border-gray-200 dark:border-gray-600 pointer-events-none -translate-x-1/2 -translate-y-1/2"
                  style={{
                    width: flagSize,
                    height: flagSize,
                    fontSize: `${emojiSize}px`,
                    left: `${leftPct(f.x)}%`,
                    top: `${topPct(f.y)}%`,
                  }}
                  initial={false}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                >
                  {f.country.flag}
                </motion.div>
              ))}
          </div>
          {/* Falling flags rendered outside container */}
          {flags.map((f) => {
            if (f.falling && f.fallY !== undefined && f.fallOpacity !== undefined) {
              const container = containerRef.current;
              const containerWidth = container ? container.offsetWidth : 0;
              // Use fallX if stacked (centered at bottom), otherwise use original position
              let fallX = f.stacked && f.fallX !== undefined 
                ? f.fallX 
                : containerWidth * (cx + f.x * scale);
              
              // For stacked flags, fallX is already calculated relative to screen center
              // For falling flags, ensure they stay within viewport
              if (!f.stacked) {
                const screenWidth = window.innerWidth || containerWidth;
                const padding = flagSize / 2;
                fallX = Math.max(padding, Math.min(screenWidth - padding, fallX));
              }
              const stackDelay = f.eliminatedOrder ? (f.eliminatedOrder - 1) * 0.1 : 0;
              
              return (
                <motion.div
                  key={`falling-${f.country.code}-${f.eliminatedOrder}`}
                  className="absolute flex items-center justify-center rounded-lg bg-white/90 dark:bg-gray-800/90 shadow-md border border-gray-200 dark:border-gray-600 pointer-events-none"
                  style={{
                    width: flagSize,
                    height: flagSize,
                    fontSize: `${emojiSize}px`,
                    left: `${fallX}px`,
                    top: `${f.fallY}px`,
                    opacity: f.fallOpacity,
                    transform: 'translate(-50%, -50%)',
                  }}
                  initial={false}
                  animate={
                    f.stacked
                      ? {
                          y: [0, -8, 0],
                          scale: [1, 1.05, 1],
                        }
                      : {}
                  }
                  transition={
                    f.stacked
                      ? {
                          duration: 0.6,
                          delay: stackDelay,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }
                      : {}
                  }
                >
                  {f.country.flag}
                </motion.div>
              );
            }
            return null;
          })}
        </div>

        {/* Controls - Fixed at bottom on mobile */}
        <div className="fixed bottom-0 left-0 right-0 md:relative md:bottom-auto md:left-auto md:right-auto flex flex-wrap items-center justify-center gap-3 p-4 md:p-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-t border-gray-200 dark:border-gray-800 md:border-t-0 md:bg-transparent md:dark:bg-transparent md:backdrop-blur-none z-40 md:z-auto">
          {gameState === "idle" && (
            <Button onClick={startGame} className="gap-2 flex items-center w-full md:w-auto">
              <Play className="h-4 w-4" />
              <span>Start Round</span>
            </Button>
          )}
          {gameState === "playing" && (
            <Button
              variant="outline"
              onClick={() => {
                const active = flags.filter((f) => !f.eliminated);
                if (active.length > 0) {
                  const chosen = active[Math.floor(Math.random() * active.length)];
                  setWinner(chosen.country);
                  setWinnerModalOpen(true);
                }
                setGameState("finished");
              }}
              className="gap-2 flex items-center w-full md:w-auto"
            >
              <Zap className="h-4 w-4" />
              <span>End Round Early</span>
            </Button>
          )}
          {gameState === "finished" && (
            <Button onClick={startGame} className="gap-2 flex items-center w-full md:w-auto">
              <RotateCcw className="h-4 w-4" />
              <span>Play Again</span>
            </Button>
          )}
        </div>

        {/* Winner Modal */}
        <Modal
          isOpen={winnerModalOpen}
          onClose={() => setWinnerModalOpen(false)}
          title=""
          size="lg"
        >
          <div className="space-y-6 relative overflow-hidden">
            {/* Enhanced Confetti particles */}
            {winner && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
                {[...Array(80)].map((_, i) => {
                  const colors = [
                    "bg-yellow-400",
                    "bg-red-400",
                    "bg-blue-400",
                    "bg-green-400",
                    "bg-purple-400",
                    "bg-pink-400",
                    "bg-orange-400",
                    "bg-indigo-400",
                  ];
                  const color = colors[Math.floor(Math.random() * colors.length)];
                  const left = `${Math.random() * 100}%`;
                  const delay = Math.random() * 3;
                  const duration = 1.5 + Math.random() * 2.5;
                  const xOffset = (Math.random() - 0.5) * 300;
                  const size = Math.random() * 8 + 4;
                  const shape = Math.random() > 0.5 ? "rounded-full" : "rounded-sm";
                  const rotation = Math.random() * 720 - 360;
                  
                  return (
                    <motion.div
                      key={i}
                      className={`absolute ${color} ${shape}`}
                      style={{
                        left,
                        width: `${size}px`,
                        height: `${size}px`,
                      }}
                      initial={{
                        y: -30,
                        x: 0,
                        opacity: 1,
                        rotate: 0,
                        scale: 1,
                      }}
                      animate={{
                        y: 700,
                        x: xOffset,
                        opacity: [1, 1, 0.8, 0],
                        rotate: rotation,
                        scale: [1, 1.2, 0.8, 0],
                      }}
                      transition={{
                        duration,
                        delay,
                        repeat: Infinity,
                        ease: [0.25, 0.46, 0.45, 0.94],
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Burst effect on open */}
            {winner && (
              <motion.div
                className="absolute inset-0 pointer-events-none"
                initial={{ scale: 0, opacity: 1 }}
                animate={{ scale: 3, opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              >
                <div className="absolute inset-0 bg-gradient-radial from-yellow-400/30 via-amber-300/20 to-transparent rounded-full" />
              </motion.div>
            )}

            {winner && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="relative flex flex-col items-center gap-3 sm:gap-4 rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-yellow-50 dark:border-amber-600 dark:from-amber-900/30 dark:to-yellow-900/20 px-4 py-6 sm:px-6 sm:py-7 md:px-8 md:py-8 overflow-hidden"
              >
                {/* Animated background glow */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-yellow-400/20 via-amber-300/30 to-yellow-400/20"
                  animate={{
                    x: ["-100%", "100%"],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />

                {/* Enhanced Sparkle effects */}
                {[...Array(16)].map((_, i) => {
                  const angle = (i * 360) / 16;
                  const radius = 100 + Math.sin(i) * 20;
                  const x = Math.cos((angle * Math.PI) / 180) * radius;
                  const y = Math.sin((angle * Math.PI) / 180) * radius;
                  return (
                    <motion.div
                      key={i}
                      className="absolute"
                      style={{
                        left: `calc(50% + ${x}px)`,
                        top: `calc(50% + ${y}px)`,
                      }}
                      initial={{ scale: 0, opacity: 0, rotate: 0 }}
                      animate={{
                        scale: [0, 1.5, 0],
                        opacity: [0, 1, 0],
                        rotate: [0, 180, 360],
                      }}
                      transition={{
                        duration: 2.5,
                        delay: i * 0.08,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    >
                      <Sparkles className="h-5 w-5 text-amber-400 drop-shadow-lg" />
                    </motion.div>
                  );
                })}

                {/* Enhanced Celebration text */}
                <motion.div
                  initial={{ scale: 0, rotate: -180, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 20,
                    delay: 0.2,
                  }}
                  className="relative"
                >
                  <motion.h2
                    animate={{
                      backgroundPosition: ["0%", "100%"],
                    }}
                    transition={{
                      duration: 3,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-amber-600 via-yellow-500 via-amber-400 to-amber-600 bg-[length:200%_auto] bg-clip-text text-transparent"
                    style={{ backgroundPosition: "0%" }}
                  >
                    🎉 Congratulations! 🎉
                  </motion.h2>
                  {/* Text glow effect */}
                  <motion.div
                    className="absolute inset-0 blur-xl opacity-50"
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-600 bg-clip-text text-transparent">
                      🎉 Congratulations! 🎉
                    </h2>
                  </motion.div>
                </motion.div>

                {/* Enhanced Winner display */}
                <motion.div
                  initial={{ scale: 0, y: 50, opacity: 0 }}
                  animate={{ scale: 1, y: 0, opacity: 1 }}
                  transition={{
                    delay: 0.4,
                    type: "spring",
                    stiffness: 250,
                    damping: 20,
                  }}
                  className="flex flex-col items-center gap-3 relative z-10"
                >
                  {/* Flag with enhanced animation */}
                  <motion.div
                    className="relative"
                    animate={{
                      scale: [1, 1.15, 1],
                      rotate: [0, 10, -10, 0],
                      y: [0, -10, 0],
                    }}
                    transition={{
                      duration: 2.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    {/* Flag glow */}
                    <motion.div
                      className="absolute inset-0 blur-2xl opacity-60"
                      animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.7, 0.4] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <span className="text-4xl sm:text-5xl md:text-6xl">{winner.flag}</span>
                    </motion.div>
                    <span className="text-5xl sm:text-6xl md:text-7xl relative z-10 drop-shadow-lg">
                      {winner.flag}
                    </span>
                  </motion.div>

                  {/* Winner name with slide-in */}
                  <motion.span
                    initial={{ opacity: 0, x: -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.6,
                      type: "spring",
                      stiffness: 200,
                      damping: 15,
                    }}
                    className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white drop-shadow-sm"
                  >
                    {winner.name}
                  </motion.span>

                  {/* Round Winner badge */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      delay: 0.8,
                      type: "spring",
                      stiffness: 200,
                      damping: 15,
                    }}
                    className="relative"
                  >
                    <motion.div
                      animate={{
                        scale: [1, 1.05, 1],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                      className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-gradient-to-r from-amber-200 to-yellow-200 dark:from-amber-800 dark:to-yellow-800 border-2 border-amber-400 dark:border-amber-600"
                    >
                      <span className="text-sm sm:text-base md:text-lg font-semibold text-amber-900 dark:text-amber-100">
                        🏆 Round Winner 🏆
                      </span>
                    </motion.div>
                  </motion.div>
                </motion.div>
              </motion.div>
            )}

            {eliminatedList.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <Users className="h-4 w-4" />
                  Eliminated (first out → last out)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {eliminatedList.slice(0, 10).map((c, i) => (
                    <span
                      key={`${c.code}-${i}`}
                      className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800"
                    >
                      <span>{c.flag}</span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {c.name}
                      </span>
                    </span>
                  ))}
                  {eliminatedList.length > 10 && (
                    <span className="inline-flex items-center rounded-md bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                      +{eliminatedList.length - 10} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}
