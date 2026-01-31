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
  Settings,
  Sparkles,
  Sun,
  Moon,
} from "lucide-react";
import { ToastContainer, useToast } from "@/components/toast";
import { useTheme } from "@/app/providers/theme-provider";

const DEFAULT_GAP_ANGLE = 35; // Default gap size in degrees
const LOGICAL_R = 1;
const BASE_FLAG_SIZE = 50;
const BASE_SPEED = 0.00015; // 50% of 0.00035 for slower bouncing
const MIN_BOUNCE_SPEED = 0.15; // Keep bouncing speed from slowing down (50% of previous)

// Calculate flag size based on number of flags
function getFlagSize(flagCount: number): number {
  // Base size for small counts, scale down as count increases
  if (flagCount <= 1000) return BASE_FLAG_SIZE;
  if (flagCount <= 20) return BASE_FLAG_SIZE * 0.75; // 27px
  if (flagCount <= 50) return BASE_FLAG_SIZE * 0.6; // 21.6px
  if (flagCount <= 100) return BASE_FLAG_SIZE * 0.45; // 16.2px
  // For 100+ flags, use even smaller size
  return BASE_FLAG_SIZE * 0.35; // 12.6px
}

type GameState = "idle" | "playing" | "finished";

interface BouncingFlag {
  id: string;
  country: Country;
  x: number;
  y: number;
  vx: number;
  vy: number;
  eliminated: boolean;
  eliminatedOrder?: number;
  exiting?: boolean;
  exitStartTime?: number;
  exitX?: number;
  exitY?: number;
  exitVelocityX?: number;
  exitVelocityY?: number;
  falling?: boolean;
  fallY?: number;
  fallX?: number;
  fallOpacity?: number;
  fallStartTime?: number;
  fallRotation?: number;
  fallVelocity?: number;
  fallDriftX?: number;
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
  // Check if angle is within the gap
  // The SVG path is rotated -90deg, placing the gap at top (angle -90deg) before outer rotation
  // Then the entire SVG rotates by gapRotation radians
  // In Math.atan2: top = -π/2, right = 0, bottom = π/2, left = ±π
  // When gapRotation = 0, gap is at top (-π/2)
  // When gapRotation = π/2, gap is at right (0)
  // So: gapCenterAngle = gapRotation - π/2
  const gapAngle = (gapAngleDegrees * Math.PI) / 180;
  const gapCenterAngle = gapRotation - Math.PI / 2;
  
  // Calculate the difference between the flag angle and gap center angle
  let diff = angle - gapCenterAngle;
  
  // Normalize to [-π, π]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  
  // Check if within gap (half gap angle on each side of gap center)
  return Math.abs(diff) <= gapAngle / 2;
}

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState>("idle");
  const [flags, setFlags] = useState<BouncingFlag[]>([]);
  const [winner, setWinner] = useState<Country | null>(null);
  const [eliminatedList, setEliminatedList] = useState<Country[]>([]);
  const [speedMult, setSpeedMult] = useState(0.25);
  const [flagCount, setFlagCount] = useState(200);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [nextRoundCountdown, setNextRoundCountdown] = useState<number | null>(null);
  const [gapRotation, setGapRotation] = useState(0);
  const [gapRotationEnabled, setGapRotationEnabled] = useState(true);
  const [gapRotationSpeed, setGapRotationSpeed] = useState(4); // 0.5x, 1x, 1.5x, 2x, 2.5x, 3x, 4x, 5x
  const [gapSize, setGapSize] = useState(DEFAULT_GAP_ANGLE); // Gap size in degrees
  const [loopEnabled, setLoopEnabled] = useState(true); // Auto-start next round
  const [winnerCounts, setWinnerCounts] = useState<Record<string, number>>({}); // country code -> win count (top 10 by wins)
  const [totalRounds, setTotalRounds] = useState(0); // total rounds played
  const eliminatedOrderRef = useRef(0);
  const flagIdRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const gapRotationRef = useRef(0);
  const eliminatedSetRef = useRef<Set<string>>(new Set());
  const gapRotationDirectionRef = useRef(1); // 1 for clockwise, -1 for counter-clockwise
  const gapDynamicSpeedRef = useRef(1); // Dynamic speed multiplier
  const lastDirectionChangeRef = useRef(0); // Track when direction/speed last changed
  const toast = useToast();
  const { theme, toggleTheme } = useTheme();

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
      const speed = 0.55 + Math.random() * 0.1;
      return {
        id: `flag-${flagIdRef.current++}`,
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
      // Use full delta so simulation speed stays constant even when FPS drops (e.g. many flags)
      const rawDt = (time - lastTime) * speedMult;
      const dt = Math.min(rawDt, 100);
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
        const containerWidth = containerEl ? containerEl.offsetWidth : 0;
        const GRAVITY = 0.0005; // Acceleration per millisecond squared
        const INITIAL_FALL_VELOCITY = 0.1; // Initial fall velocity (pixels per millisecond)
        const MAX_FALL_VELOCITY = 1.2; // Maximum fall velocity
        const ROTATION_SPEED = 0.15; // Rotation speed (degrees per millisecond)
        const FADE_SPEED = 0.0015; // opacity per millisecond

        // Calculate stack bottom position - below the circle area, above the button area
        const screenHeight = window.innerHeight || containerHeight;
        const screenWidth = window.innerWidth || containerWidth;
        // Button area is fixed at bottom with p-4 (16px padding) and button height (~48px)
        const isMobile = screenWidth < 768;
        const buttonAreaHeight = isMobile ? 80 : 0;
        
        // Calculate the bottom edge of the circle area to prevent overlap
        // The circle is centered and has radius 0.42 (42% of container)
        // Container is aspect-square with max size of min(100vw, 100vh)
        const containerRect = containerEl ? containerEl.getBoundingClientRect() : null;
        const circleContainerSize = containerRect ? Math.min(containerRect.width, containerRect.height) : Math.min(screenWidth, screenHeight);
        const circleRadius = circleContainerSize * 0.42;
        const circleCenterY = containerRect ? containerRect.top + containerRect.height / 2 : screenHeight / 2;
        const circleBottomEdge = circleCenterY + circleRadius;
        
        // Stack flags below the circle with some padding (20px gap from circle)
        const circleBottomWithPadding = circleBottomEdge + 20;
        
        // Use the lower of: screen bottom minus button area, or just above the bottom
        const stackBottom = screenHeight - buttonAreaHeight;

        // Update falling flags - let them stack at the bottom
        // First, process all flags to determine which ones are stacking
        const updated = prev.map((f) => {
          // Skip eliminated flags that aren't falling or exiting
          if (f.eliminated && !f.falling && !f.exiting) {
            return f;
          }
          
          // Handle exit animation (flag smoothly exits through gap before falling)
          if (f.exiting && f.exitStartTime !== undefined && f.exitX !== undefined && f.exitY !== undefined) {
            const exitDuration = 300; // Exit animation duration (300ms)
            const elapsed = time - f.exitStartTime;
            const progress = Math.min(elapsed / exitDuration, 1);
            
            if (progress >= 1) {
              // Exit complete - transition to falling
              // Calculate final exit position with velocity
              const finalExitX = f.exitX + (f.exitVelocityX || 0) * exitDuration * 0.001;
              const finalExitY = f.exitY + (f.exitVelocityY || 0) * exitDuration * 0.001;
              
              return {
                ...f,
                exiting: false,
                falling: true,
                fallX: finalExitX,
                fallY: finalExitY,
                fallOpacity: 1,
                fallStartTime: performance.now(),
                fallRotation: (Math.random() - 0.5) * 15, // Random initial rotation
                fallVelocity: INITIAL_FALL_VELOCITY,
                fallDriftX: (f.exitVelocityX || 0) * 0.01, // Use exit velocity for drift
              };
            }
            
            // Still exiting - keep flag in exiting state (rendering handled separately)
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
            
            // Calculate fall physics with acceleration (gravity)
            const fallStartTime = f.fallStartTime || time;
            const fallDuration = time - fallStartTime;
            
            // Calculate velocity with acceleration (v = v0 + at)
            let currentVelocity = (f.fallVelocity !== undefined ? f.fallVelocity : INITIAL_FALL_VELOCITY) + GRAVITY * fallDuration;
            currentVelocity = Math.min(currentVelocity, MAX_FALL_VELOCITY); // Cap at max velocity
            
            // Calculate new fall position with acceleration (s = v0*t + 0.5*a*t^2)
            const fallDistance = (f.fallVelocity !== undefined ? f.fallVelocity : INITIAL_FALL_VELOCITY) * dt + 0.5 * GRAVITY * dt * dt;
            const newFallY = f.fallY + fallDistance;
            
            // Calculate rotation (tumbling effect)
            const newRotation = (f.fallRotation !== undefined ? f.fallRotation : 0) + ROTATION_SPEED * dt * currentVelocity;
            
            // Add slight horizontal drift (air resistance effect)
            const driftSpeed = 0.02 * currentVelocity; // Drift increases with fall speed
            const driftDirection = f.fallDriftX !== undefined ? (f.fallDriftX > 0 ? 1 : -1) : (Math.random() > 0.5 ? 1 : -1);
            const newDriftX = (f.fallDriftX !== undefined ? f.fallDriftX : driftDirection * 0.5) + driftSpeed * dt * driftDirection * (Math.random() - 0.5);
            
            const containerLeft = containerEl ? containerEl.getBoundingClientRect().left + window.scrollX : 0;
            
            // Use smaller flag size for stacking (60% of original)
            const stackFlagSize = Math.floor(flagSize * 0.6);
            
            // Check if this flag has reached the bottom
            if (newFallY >= stackBottom - stackFlagSize) {
              // Get all already stacked flags
              const alreadyStackedFlags = prev.filter(
                (other) => 
                  other.stacked === true &&
                  other.eliminatedOrder !== undefined &&
                  other.eliminatedOrder < (f.eliminatedOrder || Infinity)
              );
              
              const alreadyStacked = alreadyStackedFlags.length;
              const screenCenterX = screenWidth / 2;
              
              // Professional grid layout with better spacing
              const horizontalPadding = Math.max(20, stackFlagSize * 0.5); // Padding from screen edges
              const availableWidth = screenWidth - (horizontalPadding * 2);
              const spacing = stackFlagSize * 1.15; // Slightly more spacing for cleaner look
              const maxFlagsPerRow = Math.max(1, Math.floor(availableWidth / spacing));
              
              // Calculate row and position
              const rowIndex = Math.floor(alreadyStacked / maxFlagsPerRow);
              const positionInRow = alreadyStacked % maxFlagsPerRow;
              
              // Count how many flags are actually in this row (including current flag)
              const flagsInSameRow = alreadyStackedFlags.filter(
                (other) => {
                  const otherRowIndex = Math.floor((other.eliminatedOrder || 0) / maxFlagsPerRow);
                  return otherRowIndex === rowIndex;
                }
              ).length + 1; // +1 for current flag
              
              // Use actual count for this row to center properly
              const actualFlagsInRow = Math.min(flagsInSameRow, maxFlagsPerRow);
              
              // Calculate Y position with consistent row height
              const rowHeight = stackFlagSize * 0.95; // Slightly tighter vertical spacing
              let rowY = stackBottom - stackFlagSize - (rowIndex * rowHeight);
              
              // Clamp rowY so flags don't stack into the circle area
              // If rowY would be above the circle bottom edge, hide the flag (very low opacity)
              const isAboveCircle = rowY < circleBottomWithPadding;
              if (isAboveCircle) {
                rowY = circleBottomWithPadding; // Clamp to just below circle
              }
              
              // Calculate X position - center the block of flags in the row (equal space left & right)
              const gapBetweenFlags = stackFlagSize * 0.15;
              const rowContentWidth = actualFlagsInRow * stackFlagSize + (actualFlagsInRow - 1) * gapBetweenFlags;
              const firstFlagCenterX = (screenWidth - rowContentWidth) / 2 + stackFlagSize / 2;
              const rowX = firstFlagCenterX + positionInRow * (stackFlagSize + gapBetweenFlags);
              
              // Hill shape: lift center of row so stack forms a mound (peak at screen center)
              const HILL_PEAK = 28;
              const hillCenterX = screenWidth / 2;
              const hillRadiusX = screenWidth * 0.42;
              const distFromCenterX = (rowX - hillCenterX) / (hillRadiusX || 1);
              const hillOffset = HILL_PEAK * Math.max(0, 1 - distFromCenterX * distFromCenterX);
              const rowYOnHill = rowY - hillOffset;
              
              // Keep opacity visible and consistent - but hide if overlapping circle
              const finalOpacity = isAboveCircle ? 0 : Math.max(0.75, f.fallOpacity);
              
              return {
                ...f,
                fallY: rowYOnHill,
                fallX: rowX,
                fallOpacity: finalOpacity,
                fallRotation: 0, // Reset rotation when stacked for clean alignment
                stacked: true, // Mark as stacked - position is now fixed
              };
            }
            
            // Still falling - continue animation with physics
            // Fade opacity gradually, but slower as it falls faster
            const fadeMultiplier = Math.max(0.3, 1 - (currentVelocity / MAX_FALL_VELOCITY) * 0.5);
            const newOpacity = Math.max(0.8, f.fallOpacity - dt * FADE_SPEED * fadeMultiplier);
            
            return {
              ...f,
              fallY: newFallY,
              fallOpacity: newOpacity,
              fallRotation: newRotation,
              fallVelocity: currentVelocity,
              fallDriftX: newDriftX,
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
              const intersectDist = Math.sqrt(intersectX * intersectX + intersectY * intersectY);
              
              // If passing through gap and at boundary, start exit animation
              if (isInGap(intersectAngle, currentGapRotation, gapSize) && intersectDist >= maxFlagCenterDistance * 0.98) {
                // Flag is exiting through gap - start professional exit animation
                if (!eliminatedSetRef.current.has(f.country.code)) {
                  eliminatedOrderRef.current += 1;
                  eliminatedSetRef.current.add(f.country.code);
                  setEliminatedList((list) => [...list, f.country]);
                }
                const containerRect = containerEl ? containerEl.getBoundingClientRect() : null;
                const containerLeft = containerRect ? containerRect.left : 0;
                const containerTop = containerRect ? containerRect.top : 0;
                // Push exit position outward from circle edge for more visible gap
                const EXIT_GAP_OFFSET = 0.12; // Logical units (~12% of radius) - gap between circle and exiting flag
                const nx = intersectX / (intersectDist || 0.001);
                const ny = intersectY / (intersectDist || 0.001);
                const exitPosX = intersectX + nx * EXIT_GAP_OFFSET;
                const exitPosY = intersectY + ny * EXIT_GAP_OFFSET;
                const exitX = containerLeft + containerWidthForCollision * (cx + exitPosX * scale);
                const exitY = containerTop + containerHeightForCollision * (cy + exitPosY * scale);
                
                // Calculate exit velocity based on flag's current velocity (maintain momentum)
                const exitSpeed = Math.sqrt(f.vx * f.vx + f.vy * f.vy) * BASE_SPEED * 60;
                const exitAngle = Math.atan2(intersectY, intersectX);
                const exitVelocityX = Math.cos(exitAngle) * exitSpeed * containerWidthForCollision * scale * 0.5; // pixels per ms
                const exitVelocityY = Math.sin(exitAngle) * exitSpeed * containerHeightForCollision * scale * 0.5; // pixels per ms
                
                return {
                  ...f,
                  eliminated: true,
                  eliminatedOrder: eliminatedOrderRef.current,
                  exiting: true,
                  exitStartTime: performance.now(),
                  exitX: exitX,
                  exitY: exitY,
                  exitVelocityX: exitVelocityX,
                  exitVelocityY: exitVelocityY,
                  x: intersectX,
                  y: intersectY,
                };
              } else if (!isInGap(intersectAngle, currentGapRotation, gapSize)) {
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
            // Flag crossed maxFlagCenterDistance but not radius yet
            // Check if it's in the gap area before clamping
            const dx = x - prevX;
            const dy = y - prevY;
            const segmentLength = Math.sqrt(dx * dx + dy * dy);
            
            if (segmentLength > 0) {
              // Find intersection point at maxFlagCenterDistance
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
              
              // Check gap at intersection point (even though it's at maxFlagCenterDistance, not radius)
              // This allows flags to exit through the gap even when they're at the visual boundary
              const intersectX = prevX + t * dx;
              const intersectY = prevY + t * dy;
              const intersectAngle = Math.atan2(intersectY, intersectX);
              const currentGapRotation = gapRotationEnabled ? gapRotationRef.current : 0;
              
              // If in gap area, allow it to continue outward (don't clamp yet)
              if (isInGap(intersectAngle, currentGapRotation, gapSize)) {
                // Flag is in gap area - let it continue, it will be checked again at radius
                // Don't clamp here, let it reach radius where elimination happens
              } else {
                // Not in gap - clamp to boundary
                x = prevX + t * dx;
                y = prevY + t * dy;
                dist = Math.sqrt(x * x + y * y);
              }
            }
          }

          // Check if flag is in the gap area - do this check BEFORE any clamping
          const angle = Math.atan2(y, x);
          const currentGapRotation = gapRotationEnabled ? gapRotationRef.current : 0;
          const isInGapArea = isInGap(angle, currentGapRotation, gapSize);
          
          // If flag is in gap area and is at or near the boundary, start exit animation
          // Use a slightly larger threshold to catch flags that are very close to the boundary
          const eliminationThreshold = maxFlagCenterDistance * 1.02; // 2% tolerance
          if (isInGapArea && dist >= maxFlagCenterDistance * 0.98) {
            // Flag exits through gap - start professional exit animation
            if (!eliminatedSetRef.current.has(f.country.code)) {
              eliminatedOrderRef.current += 1;
              eliminatedSetRef.current.add(f.country.code);
              setEliminatedList((list) => [...list, f.country]);
            }
            // Convert logical position to pixel position for exit animation (viewport coordinates for fixed overlay)
            const containerRect = containerEl ? containerEl.getBoundingClientRect() : null;
            const containerLeft = containerRect ? containerRect.left : 0;
            const containerTop = containerRect ? containerRect.top : 0;
            // Push exit position outward from circle edge for more visible gap
            const EXIT_GAP_OFFSET = 0.12;
            const nx = x / (dist || 0.001);
            const ny = y / (dist || 0.001);
            const exitPosX = x + nx * EXIT_GAP_OFFSET;
            const exitPosY = y + ny * EXIT_GAP_OFFSET;
            const exitX = containerLeft + containerWidthForCollision * (cx + exitPosX * scale);
            const exitY = containerTop + containerHeightForCollision * (cy + exitPosY * scale);
            
            // Calculate exit velocity based on flag's current velocity (maintain momentum)
            const exitSpeed = Math.sqrt(f.vx * f.vx + f.vy * f.vy) * BASE_SPEED * 60;
            const exitAngle = Math.atan2(y, x);
            const exitVelocityX = Math.cos(exitAngle) * exitSpeed * containerWidthForCollision * scale * 0.5; // pixels per ms
            const exitVelocityY = Math.sin(exitAngle) * exitSpeed * containerHeightForCollision * scale * 0.5; // pixels per ms
            
            return {
              ...f,
              eliminated: true,
              eliminatedOrder: eliminatedOrderRef.current,
              exiting: true,
              exitStartTime: performance.now(),
              exitX: exitX,
              exitY: exitY,
              exitVelocityX: exitVelocityX,
              exitVelocityY: exitVelocityY,
              x: x,
              y: y,
            };
          }
          
          // Check if flag center has crossed the visual circle boundary (radius 0.42)
          // Use circular distance check - this ensures circular bouncing area
          if (dist > radius) {
            // Flag crossed radius but not in gap - bounce back
            
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

        // Flag-to-flag collision detection and response
        // Check each flag against all other flags for collisions
        const finalFlags = next.map((f, i) => {
          // Skip eliminated or falling flags
          if (f.eliminated || f.falling) return f;
          
          let newVx = f.vx;
          let newVy = f.vy;
          let newX = f.x;
          let newY = f.y;
          let collided = false;
          
          // Check collision with all other flags
          for (let j = 0; j < next.length; j++) {
            if (i === j) continue; // Skip self
            const other = next[j];
            
            // Skip eliminated or falling flags
            if (other.eliminated || other.falling) continue;
            
            // Calculate distance between flag centers
            const dx = f.x - other.x;
            const dy = f.y - other.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Collision occurs when distance is less than flag diameter (2 * flagRadiusLogical)
            const minDistance = flagSizeLogical * 0.9; // Slightly less than diameter for better collision feel
            if (distance < minDistance && distance > 0.001) {
              // Collision detected - calculate collision response
              collided = true;
              
              // Normalize collision vector
              const nx = dx / distance;
              const ny = dy / distance;
              
              // Relative velocity
              const relativeVx = f.vx - other.vx;
              const relativeVy = f.vy - other.vy;
              
              // Relative velocity along collision normal
              const relativeSpeed = relativeVx * nx + relativeVy * ny;
              
              // Only resolve collision if flags are moving towards each other
              if (relativeSpeed < 0) {
                // Elastic collision response
                // Exchange momentum along collision normal
                const impulse = 2 * relativeSpeed / 2; // Divide by 2 because both flags have same mass
                
                // Update velocities
                newVx = f.vx - impulse * nx;
                newVy = f.vy - impulse * ny;
                
                // Separate flags to prevent overlap
                const overlap = minDistance - distance;
                const separationX = nx * overlap * 0.5;
                const separationY = ny * overlap * 0.5;
                newX = f.x + separationX;
                newY = f.y + separationY;
              }
            }
          }
          
          // Return updated flag with new velocity and position if collision occurred
          if (collided) {
            return { ...f, x: newX, y: newY, vx: newVx, vy: newVy };
          }
          
          return f;
        });

        // Keep bouncing speed from slowing down: enforce minimum velocity (no long-term drift)
        const finalFlagsWithMinSpeed = finalFlags.map((f) => {
          if (f.eliminated || f.falling) return f;
          const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
          if (speed < MIN_BOUNCE_SPEED && speed > 0.001) {
            const scale = MIN_BOUNCE_SPEED / speed;
            return { ...f, vx: f.vx * scale, vy: f.vy * scale };
          }
          return f;
        });
        
        // Recalculate positions for all stacked flags to ensure proper centering
        // Group flags by row and recalculate their positions
        // Reuse existing variables (screenHeight, isMobile, buttonAreaHeight, stackBottom are already defined above)
        // Use smaller flag size for stacking (60% of original)
        const recalcStackFlagSize = Math.floor(flagSize * 0.6);
        const recalcScreenWidth = window.innerWidth || (containerEl ? containerEl.offsetWidth : 0);
        const recalcScreenCenterX = recalcScreenWidth / 2;
        const recalcHorizontalPadding = Math.max(20, recalcStackFlagSize * 0.5);
        const recalcAvailableWidth = recalcScreenWidth - (recalcHorizontalPadding * 2);
        const recalcSpacing = recalcStackFlagSize * 1.15;
        const recalcMaxFlagsPerRow = Math.max(1, Math.floor(recalcAvailableWidth / recalcSpacing));
        
        // Group stacked flags by row
        const flagsByRow = new Map<number, typeof finalFlagsWithMinSpeed>();
        finalFlagsWithMinSpeed.forEach((f) => {
          if (f.stacked && f.eliminatedOrder !== undefined) {
            const rowIndex = Math.floor((f.eliminatedOrder - 1) / recalcMaxFlagsPerRow);
            if (!flagsByRow.has(rowIndex)) {
              flagsByRow.set(rowIndex, []);
            }
            flagsByRow.get(rowIndex)!.push(f);
          }
        });
        
        // Recalculate positions for each row to ensure proper centering
        const recalculatedFlags = finalFlagsWithMinSpeed.map((f) => {
          if (f.stacked && f.eliminatedOrder !== undefined) {
            const rowIndex = Math.floor((f.eliminatedOrder - 1) / recalcMaxFlagsPerRow);
            const rowFlags = flagsByRow.get(rowIndex) || [];
            const sortedRowFlags = [...rowFlags].sort((a, b) => (a.eliminatedOrder || 0) - (b.eliminatedOrder || 0));
            const positionInRow = sortedRowFlags.findIndex((flag) => flag.eliminatedOrder === f.eliminatedOrder);
            const actualFlagsInRow = sortedRowFlags.length;
            
            if (positionInRow >= 0) {
              const rowHeight = recalcStackFlagSize * 0.95;
              let rowY = stackBottom - recalcStackFlagSize - (rowIndex * rowHeight);
              
              // Clamp rowY so flags don't stack into the circle area
              const isAboveCircle = rowY < circleBottomWithPadding;
              if (isAboveCircle) {
                rowY = circleBottomWithPadding;
              }
              
              // Center the block of flags in the row (equal space left & right)
              const gapBetweenFlags = recalcStackFlagSize * 0.15;
              const rowContentWidth = actualFlagsInRow * recalcStackFlagSize + (actualFlagsInRow - 1) * gapBetweenFlags;
              const firstFlagCenterX = (recalcScreenWidth - rowContentWidth) / 2 + recalcStackFlagSize / 2;
              const rowX = firstFlagCenterX + positionInRow * (recalcStackFlagSize + gapBetweenFlags);
              
              // Hill shape: 2D mound (peak at screen center and middle row)
              const HILL_PEAK_X = 28;
              const HILL_PEAK_Y = 14;
              const hillCenterX = recalcScreenWidth / 2;
              const hillRadiusX = recalcScreenWidth * 0.42;
              const totalRows = flagsByRow.size;
              const centerRow = (totalRows - 1) / 2;
              const radiusRow = Math.max(1, totalRows * 0.5);
              const distFromCenterX = (rowX - hillCenterX) / (hillRadiusX || 1);
              const horizontalFactor = Math.max(0, 1 - distFromCenterX * distFromCenterX);
              const distFromCenterRow = (rowIndex - centerRow) / radiusRow;
              const verticalFactor = Math.max(0, 1 - distFromCenterRow * distFromCenterRow);
              const hillOffset = HILL_PEAK_X * horizontalFactor + HILL_PEAK_Y * verticalFactor;
              const rowYOnHill = rowY - hillOffset;
              
              return {
                ...f,
                fallX: rowX,
                fallY: rowYOnHill,
                fallOpacity: isAboveCircle ? 0 : f.fallOpacity, // Hide if overlapping circle
              };
            }
          }
          return f;
        });
        
        // Count active flags (not eliminated, not falling, not exiting) after processing eliminations
        const active = recalculatedFlags.filter((f) => !f.eliminated && !f.falling && !f.exiting);
        const prevActiveCount = prev.filter((f) => !f.eliminated && !f.falling && !f.exiting).length;
        
        // Game over when 2nd-to-last flag is eliminated (when going from 2 to 1)
        if (active.length === 1 && prevActiveCount === 2) {
          setWinner(active[0].country);
          setGameState("finished");
          return recalculatedFlags;
        }
        
        // Also handle edge case when game ends with 0 flags
        if (active.length === 0 && prevActiveCount > 0) {
          setGameState("finished");
          return recalculatedFlags;
        }

        return recalculatedFlags;
      });

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [gameState, speedMult, flags.length, gapRotationEnabled, gapRotationSpeed, gapSize, loopEnabled, winnerCounts]);

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
          id: `flag-${flagIdRef.current++}`,
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

  // No modal - congratulations shown inside circle

  const prevGameStateRef = useRef<GameState>(gameState);
  // When round finishes: increment total rounds and (if loop) winner win count
  useEffect(() => {
    if (prevGameStateRef.current !== "finished" && gameState === "finished") {
      setTotalRounds((prev) => prev + 1);
    }
    prevGameStateRef.current = gameState;
    if (gameState === "finished" && loopEnabled && winner) {
      setWinnerCounts((prev) => ({
        ...prev,
        [winner.code]: (prev[winner.code] ?? 0) + 1,
      }));
    }
  }, [gameState, loopEnabled, winner]);

  // Initialize countdown when round finishes with loop enabled
  useEffect(() => {
    if (gameState === "finished" && loopEnabled && winner) {
      setNextRoundCountdown(3);
    } else {
      setNextRoundCountdown(null);
    }
  }, [gameState, loopEnabled, winner]);

  // Countdown tick - start next round when it reaches 0
  useEffect(() => {
    if (nextRoundCountdown === null || nextRoundCountdown <= 0) return;

    const timer = setTimeout(() => {
      setNextRoundCountdown((prev) => {
        if (prev === null || prev <= 1) {
          setTimeout(() => startGame(), 300);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [nextRoundCountdown, startGame]);

  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden bg-gray-50 transition-colors dark:bg-gray-950">
      {/* Top bar: Play left, Total rounds center, Settings right */}
      <div className="fixed bottom-0 left-0 right-0 z-50 grid grid-cols-3 items-center p-4">
        <div className="flex justify-start">
          {gameState === "idle" && (
            <Button onClick={startGame} className="w-10 h-10 p-0 flex items-center justify-center shrink-0" aria-label="Start Round">
              <Play className="h-5 w-5" />
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
                }
                setGameState("finished");
              }}
              className="w-10 h-10 p-0 flex items-center justify-center shrink-0"
              aria-label="End Round Early"
            >
              <Zap className="h-5 w-5" />
            </Button>
          )}
          {gameState === "finished" && (
            <Button onClick={startGame} className="w-10 h-10 p-0 flex items-center justify-center shrink-0" aria-label="Play Again">
              <RotateCcw className="h-5 w-5" />
            </Button>
          )}
        </div>
        <div className="flex justify-center pointer-events-none">
          <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-semibold text-base shadow-sm border border-amber-200/60 dark:border-amber-700/50">
            Round {totalRounds}
          </span>
        </div>
        <div className="flex justify-end items-center gap-2">
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 bg-white/90 dark:bg-gray-800/90 shadow border border-gray-200 dark:border-gray-700 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </button>
          <button
            // onClick={() => setSettingsModalOpen(true)}
            className="rounded-lg p-2 bg-white/90 dark:bg-gray-800/90 shadow border border-gray-200 dark:border-gray-700 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
            aria-label="Open settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>

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

      {/* Game arena - starts right after Round count bar */}
      <div className="absolute top-[-80px] left-0 right-0 bottom-0 flex flex-col items-center justify-center w-full h-full overflow-hidden">

           {loopEnabled && Object.keys(winnerCounts).length > 0 && (() => {
          const sorted = Object.entries(winnerCounts).sort(([, a], [, b]) => b - a);
          const top9Slice = sorted.slice(0, 9);
          const top9 = top9Slice
            .map(([code, wins]) => ({ country: countries.find((c) => c.code === code), wins }))
            .filter((entry): entry is { country: Country; wins: number } => entry.country != null);
          return (
            <div className="fixed top-4 left-0 right-0 z-30 px-1 md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto md:mt-2 md:pb-0 w-full max-w-[min(100vw,100vh)] flex-shrink-0 pointer-events-none">
              <div className="dark:bg-amber-950/80 px-3 py-2 mx-auto max-w-[min(100vw,100vh)] pointer-events-auto">
                {/* Top 9 in 3 columns: col1 = 1,2,3 | col2 = 4,5,6 | col3 = 7,8,9 */}
                <div className="grid grid-cols-3 grid-rows-3 grid-flow-col gap-x-2 gap-y-0.5">
                  {top9.map(({ country, wins }, i) => (
                    <div
                      key={`${country.code}-${i}`}
                      className="flex items-center justify-between gap-1.5 rounded-md bg-white/90 dark:bg-gray-800/90 px-1.5 py-0.5 text-xs border border-amber-100 dark:border-amber-800/50"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span>{i + 1}.</span>
                        <span>{country.flag}</span>
                        <span className="text-gray-700 dark:text-gray-300 font-medium truncate max-w-[70px] sm:max-w-[90px]">
                          {country.name}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                        {wins} {wins === 1 ? "x" : "x"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}



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
              {/* Circle border as arc (excluding gap) */}
              {/* Gap is centered at angle 0 (right) before -90deg rotation, becomes top after rotation */}
              {/* In SVG: angle 0 = right, 90deg = bottom, -90deg = top */}
              {/* After -90deg rotation: what was right (angle 0) becomes top (angle -90deg) */}
              {/* So we draw gap centered at angle 0 before the path rotation */}
              <path
                d={`M ${50 + 42 * Math.cos((gapSize / 2) * Math.PI / 180)} ${50 + 42 * Math.sin((gapSize / 2) * Math.PI / 180)} A 42 42 0 1 1 ${50 + 42 * Math.cos((360 - gapSize / 2) * Math.PI / 180)} ${50 + 42 * Math.sin((360 - gapSize / 2) * Math.PI / 180)}`}
                fill="none"
                stroke="rgba(59, 130, 246, 0.9)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: "rotate(-90deg)",
                  transformOrigin: "50% 50%",
                }}
              />
            </svg>
            {flags
              .filter((f) => !f.eliminated && !f.falling && !f.exiting)
              .map((f) => (
                <motion.div
                  key={f.id}
                  className="absolute flex items-center justify-center rounded-lg pointer-events-none -translate-x-1/2 -translate-y-1/2"
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

            {/* Congratulations inside circle when round finished - with celebration */}
            {gameState === "finished" && winner && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 sm:gap-3 p-4 pointer-events-none z-10 overflow-hidden rounded-3xl"
              >
                {/* Celebration confetti inside circle */}
                <div className="absolute inset-0 pointer-events-none">
                  {[...Array(40)].map((_, i) => {
                    const colors = ["bg-yellow-400", "bg-red-400", "bg-blue-400", "bg-green-400", "bg-purple-400", "bg-pink-400", "bg-amber-400", "bg-indigo-400"];
                    const color = colors[i % colors.length];
                    const left = `${(i * 13) % 100}%`;
                    const delay = (i * 0.05) % 2;
                    const duration = 1.2 + (i % 3) * 0.4;
                    const size = 4 + (i % 5);
                    const shape = i % 2 === 0 ? "rounded-full" : "rounded-sm";
                    const rotation = (i * 90) % 360;
                    return (
                      <motion.div
                        key={i}
                        className={`absolute ${color} ${shape}`}
                        style={{ left, width: size, height: size, top: -10 }}
                        initial={{ y: 0, opacity: 1, rotate: 0, scale: 1 }}
                        animate={{
                          y: 120,
                          opacity: [1, 1, 0.6, 0],
                          rotate: rotation,
                          scale: [1, 1.1, 0.8],
                        }}
                        transition={{ duration, delay, repeat: Infinity, repeatDelay: 0.5, ease: "easeIn" }}
                      />
                    );
                  })}
                </div>

                {/* Burst / glow on appear */}
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  initial={{ scale: 0, opacity: 0.8 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                >
                  <div className="absolute inset-0 bg-gradient-radial from-yellow-400/40 via-amber-300/20 to-transparent rounded-full" />
                </motion.div>

                {/* Sparkles around center */}
                {[...Array(12)].map((_, i) => {
                  const angle = (i / 12) * 360;
                  const r = 22 + (i % 2) * 5;
                  const x = Math.cos((angle * Math.PI) / 180) * r;
                  const y = Math.sin((angle * Math.PI) / 180) * r;
                  return (
                    <motion.div
                      key={i}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `calc(50% + ${x}%)`, top: `calc(50% + ${y}%)` }}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: [0, 1.2, 0.8], opacity: [0, 1, 0.7] }}
                      transition={{ duration: 1.5, delay: i * 0.06, repeat: Infinity, repeatDelay: 0.3, ease: "easeInOut" }}
                    >
                      <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-amber-400 drop-shadow" />
                    </motion.div>
                  );
                })}

                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="text-base sm:text-lg md:text-xl font-bold bg-gradient-to-r from-amber-600 to-yellow-500 bg-clip-text text-transparent relative z-10"
                >
                  🎉 Congratulations! 🎉
                </motion.p>
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.25, type: "spring", stiffness: 200, damping: 18 }}
                  className="flex flex-col items-center gap-1 relative z-10"
                >
                  <motion.span
                    animate={{ scale: [1, 1.08, 1], rotate: [0, 5, -5, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="text-3xl sm:text-4xl md:text-5xl drop-shadow-md inline-block"
                  >
                    {winner.flag}
                  </motion.span>
                  <span className="text-sm sm:text-base md:text-lg font-bold text-gray-900 dark:text-white">
                    {winner.name}
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-amber-700 dark:text-amber-300">
                    🏆 Round Winner 🏆
                  </span>
                </motion.div>
                {loopEnabled && nextRoundCountdown !== null && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex flex-col items-center mt-1 relative z-10"
                  >
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Next round in</p>
                    <p className="text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                      {nextRoundCountdown}
                    </p>
                  </motion.div>
                )}
              </motion.div>
            )}
          </div>
        </div>


      </div>

      {/* Exiting & falling flags - viewport overlay with depth, shadows, and advanced easing */}
      <div className="fixed inset-0 pointer-events-none z-40 isolate">
        {/* Exiting flags: fly-out with depth shadow and smooth easing */}
        {flags
          .filter((f): f is typeof f & { exitX: number; exitY: number; exitStartTime: number } =>
            Boolean(f.exiting && f.exitX != null && f.exitY != null && f.exitStartTime != null)
          )
          .map((f) => {
            const exitDuration = 320;
            const elapsed = performance.now() - f.exitStartTime;
            const t = Math.min(elapsed / exitDuration, 1);
            const easeOutExpo = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
            const easeOutCubic = 1 - Math.pow(1 - t, 3);
            const vx = f.exitVelocityX ?? 0;
            const vy = f.exitVelocityY ?? 0;
            const currentExitX = f.exitX + vx * elapsed * 0.5 * easeOutExpo;
            const currentExitY = f.exitY + vy * elapsed * 0.5 * easeOutExpo;
            const exitScale = 1 + easeOutCubic * 0.2;
            const exitRotation = (vx >= 0 ? 1 : -1) * easeOutCubic * 35;
            const exitOpacity = 1 - easeOutCubic * 0.15;
            const shadowBlur = 4 + easeOutCubic * 12;
            const shadowY = 2 + easeOutCubic * 8;
            const order = f.eliminatedOrder ?? 0;
            return (
              <motion.div
                key={`exiting-${f.id}-${order}`}
                className="absolute flex items-center justify-center rounded-lg pointer-events-none overflow-visible"
                style={{
                  width: flagSize,
                  height: flagSize,
                  left: currentExitX,
                  top: currentExitY,
                  zIndex: 40 + order,
                  transform: `translate(-50%, -50%) rotate(${exitRotation}deg) scale(${exitScale})`,
                  transformOrigin: "center center",
                  opacity: exitOpacity,
                  filter: `drop-shadow(0 ${shadowY}px ${shadowBlur}px rgba(0,0,0,0.25)) drop-shadow(0 2px 4px rgba(0,0,0,0.15))`,
                  transition: "filter 0.08s ease-out",
                }}
                initial={false}
              >
                {f.country.flag}
              </motion.div>
            );
          })}

        {/* Falling & stacked flags: tumble with velocity-based shadow, layered stack */}
        {/* {flags
          .filter((f): f is typeof f & { fallY: number; fallOpacity: number } =>
            Boolean(f.falling && f.fallY != null && f.fallOpacity != null)
          )
          .map((f) => {
            const container = containerRef.current;
            const containerWidth = container?.offsetWidth ?? 0;
            const containerRect = container?.getBoundingClientRect() ?? null;
            const fallingFlagSize = Math.floor(flagSize * 0.6);
            const fallingEmojiSize = Math.max(10, Math.floor(fallingFlagSize * 0.6));
            let fallX =
              f.fallX ??
              (containerRect ? containerRect.left : 0) + containerWidth * (cx + (f.x ?? 0) * scale);
            const screenWidth = typeof window !== "undefined" ? window.innerWidth : containerWidth;
            const padding = fallingFlagSize / 2;
            fallX = Math.max(padding, Math.min(screenWidth - padding, fallX));
            const stackDelay = f.eliminatedOrder != null ? (f.eliminatedOrder - 1) * 0.1 : 0;
            const fallScale = f.stacked ? 1 : Math.max(0.82, 1 - (f.fallVelocity ?? 0) * 0.12);
            const rotation = f.stacked ? 0 : (f.fallRotation ?? 0);
            const driftX = f.stacked ? 0 : (f.fallDriftX ?? 0) * 20;
            const adjustedFallX = fallX + driftX;
            const velocity = f.fallVelocity ?? 0;
            const shadowOffset = f.stacked ? 2 : Math.min(4 + velocity * 3, 12);
            const shadowBlur = f.stacked ? 4 : Math.min(6 + velocity * 4, 16);
            const order = f.eliminatedOrder ?? 0;
            return (
              <motion.div
                key={`falling-${f.id}-${order}`}
                className="absolute flex items-center justify-center rounded-lg pointer-events-none overflow-visible"
                style={{
                  width: fallingFlagSize,
                  height: fallingFlagSize,
                  fontSize: fallingEmojiSize,
                  left: adjustedFallX,
                  top: f.fallY,
                  zIndex: 30 + order,
                  opacity: f.fallOpacity,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${fallScale})`,
                  transformOrigin: "center center",
                  filter: `drop-shadow(0 ${shadowOffset}px ${shadowBlur}px rgba(0,0,0,0.2)) drop-shadow(0 1px 3px rgba(0,0,0,0.12))`,
                  transition: f.stacked
                    ? "left 0.35s cubic-bezier(0.34, 1.2, 0.64, 1), top 0.35s cubic-bezier(0.34, 1.2, 0.64, 1), transform 0.35s cubic-bezier(0.34, 1.2, 0.64, 1), filter 0.25s ease-out"
                    : "transform 0.06s linear, opacity 0.08s ease-out, filter 0.1s ease-out",
                  willChange: f.stacked ? "transform, left, top, filter" : "transform, opacity, filter",
                }}
                initial={false}
                animate={
                  f.stacked
                    ? {
                        y: [0, -5, 0],
                        scale: [1, 1.04, 1],
                      }
                    : {}
                }
                transition={
                  f.stacked
                    ? {
                        duration: 0.9,
                        delay: stackDelay * 0.4,
                        repeat: Infinity,
                        repeatDelay: 0.2,
                        ease: "easeInOut",
                      }
                    : {}
                }
              >
                {f.country.flag}
              </motion.div>
            );
          })} */}
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}
