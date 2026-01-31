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
  const [flagCount, setFlagCount] = useState(20);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [winnerModalOpen, setWinnerModalOpen] = useState(false);
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
        const GRAVITY = 0.0005; // Acceleration per millisecond squared
        const INITIAL_FALL_VELOCITY = 0.1; // Initial fall velocity (pixels per millisecond)
        const MAX_FALL_VELOCITY = 1.2; // Maximum fall velocity
        const ROTATION_SPEED = 0.15; // Rotation speed (degrees per millisecond)
        const FADE_SPEED = 0.0015; // opacity per millisecond

        // Calculate stack bottom position - above the button area and Top 10 panel
        const screenHeight = window.innerHeight || containerHeight;
        // Button area is fixed at bottom with p-4 (16px padding) and button height (~48px)
        const isMobile = window.innerWidth < 768;
        const buttonAreaHeight = isMobile ? 80 : 0;
        // When loop enabled and Top 10 winners is visible, reserve space so falling flags don't overlap it (reduced gap)
        const top10PanelHeight = (loopEnabled && Object.keys(winnerCounts).length > 0) ? 100 : 0;
        const stackBottom = screenHeight - buttonAreaHeight - top10PanelHeight;

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
            
            const containerWidth = containerEl ? containerEl.offsetWidth : 0;
            const containerLeft = containerEl ? containerEl.getBoundingClientRect().left + window.scrollX : 0;
            
            // Check if this flag has reached the bottom
            if (newFallY >= stackBottom - flagSize) {
              // Get all already stacked flags
              const alreadyStackedFlags = prev.filter(
                (other) => 
                  other.stacked === true &&
                  other.eliminatedOrder !== undefined &&
                  other.eliminatedOrder < (f.eliminatedOrder || Infinity)
              );
              
              const alreadyStacked = alreadyStackedFlags.length;
              
              const screenWidth = window.innerWidth || containerWidth;
              const screenCenterX = screenWidth / 2;
              
              // Professional grid layout with better spacing
              const horizontalPadding = Math.max(20, flagSize * 0.5); // Padding from screen edges
              const availableWidth = screenWidth - (horizontalPadding * 2);
              const spacing = flagSize * 1.15; // Slightly more spacing for cleaner look
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
              const rowHeight = flagSize * 0.95; // Slightly tighter vertical spacing
              const rowY = stackBottom - flagSize - (rowIndex * rowHeight);
              
              // Calculate X position - center the block of flags in the row (equal space left & right)
              const gapBetweenFlags = flagSize * 0.15;
              const rowContentWidth = actualFlagsInRow * flagSize + (actualFlagsInRow - 1) * gapBetweenFlags;
              const firstFlagCenterX = (screenWidth - rowContentWidth) / 2 + flagSize / 2;
              const rowX = firstFlagCenterX + positionInRow * (flagSize + gapBetweenFlags);
              
              // Keep opacity visible and consistent
              const finalOpacity = Math.max(0.75, f.fallOpacity);
              
              return {
                ...f,
                fallY: rowY,
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
        
        // Recalculate positions for all stacked flags to ensure proper centering
        // Group flags by row and recalculate their positions
        // Reuse existing variables (screenHeight, isMobile, buttonAreaHeight, stackBottom are already defined above)
        const recalcScreenWidth = window.innerWidth || (containerEl ? containerEl.offsetWidth : 0);
        const recalcScreenCenterX = recalcScreenWidth / 2;
        const recalcHorizontalPadding = Math.max(20, flagSize * 0.5);
        const recalcAvailableWidth = recalcScreenWidth - (recalcHorizontalPadding * 2);
        const recalcSpacing = flagSize * 1.15;
        const recalcMaxFlagsPerRow = Math.max(1, Math.floor(recalcAvailableWidth / recalcSpacing));
        
        // Group stacked flags by row
        const flagsByRow = new Map<number, typeof finalFlags>();
        finalFlags.forEach((f) => {
          if (f.stacked && f.eliminatedOrder !== undefined) {
            const rowIndex = Math.floor((f.eliminatedOrder - 1) / recalcMaxFlagsPerRow);
            if (!flagsByRow.has(rowIndex)) {
              flagsByRow.set(rowIndex, []);
            }
            flagsByRow.get(rowIndex)!.push(f);
          }
        });
        
        // Recalculate positions for each row to ensure proper centering
        const recalculatedFlags = finalFlags.map((f) => {
          if (f.stacked && f.eliminatedOrder !== undefined) {
            const rowIndex = Math.floor((f.eliminatedOrder - 1) / recalcMaxFlagsPerRow);
            const rowFlags = flagsByRow.get(rowIndex) || [];
            const sortedRowFlags = [...rowFlags].sort((a, b) => (a.eliminatedOrder || 0) - (b.eliminatedOrder || 0));
            const positionInRow = sortedRowFlags.findIndex((flag) => flag.eliminatedOrder === f.eliminatedOrder);
            const actualFlagsInRow = sortedRowFlags.length;
            
            if (positionInRow >= 0) {
              const rowHeight = flagSize * 0.95;
              const rowY = stackBottom - flagSize - (rowIndex * rowHeight);
              
              // Center the block of flags in the row (equal space left & right)
              const gapBetweenFlags = flagSize * 0.15;
              const rowContentWidth = actualFlagsInRow * flagSize + (actualFlagsInRow - 1) * gapBetweenFlags;
              const firstFlagCenterX = (recalcScreenWidth - rowContentWidth) / 2 + flagSize / 2;
              const rowX = firstFlagCenterX + positionInRow * (flagSize + gapBetweenFlags);
              
              return {
                ...f,
                fallX: rowX,
                fallY: rowY,
              };
            }
          }
          return f;
        });
        
        // Count active flags (not eliminated, not falling, not exiting) after processing eliminations
        const active = recalculatedFlags.filter((f) => !f.eliminated && !f.falling && !f.exiting);
        const prevActiveCount = prev.filter((f) => !f.eliminated && !f.falling && !f.exiting).length;
        
        // Show modal when 2nd-to-last flag is eliminated (when going from 2 to 1)
        if (active.length === 1 && prevActiveCount === 2) {
          setWinner(active[0].country);
          setWinnerModalOpen(true);
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

  // Open winner modal when winner is set
  useEffect(() => {
    if (winner && gameState === "finished") {
      setWinnerModalOpen(true);
    }
  }, [winner, gameState]);

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

  // Initialize countdown when winner modal opens with loop enabled
  useEffect(() => {
    if (winnerModalOpen && loopEnabled && winner) {
      setNextRoundCountdown(5);
    } else {
      setNextRoundCountdown(null);
    }
  }, [winnerModalOpen, loopEnabled, winner]);

  // Countdown tick - start next round when it reaches 0
  useEffect(() => {
    if (nextRoundCountdown === null || nextRoundCountdown <= 0) return;

    const timer = setTimeout(() => {
      setNextRoundCountdown((prev) => {
        if (prev === null || prev <= 1) {
          setWinnerModalOpen(false);
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
      <div className="fixed top-0 left-0 right-0 z-50 grid grid-cols-3 items-center p-4">
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
                  setWinnerModalOpen(true);
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
        <div className="flex justify-end">
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
      <div className="absolute top-[-100px] left-0 right-0 bottom-0 flex flex-col items-center justify-center w-full h-full overflow-hidden">
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
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: "rotate(-90deg)",
                  transformOrigin: "50% 50%",
                }}
              />
              {/* Red marker for gap area - exactly matches the gap position */}
              {/* Gap spans from -gapSize/2 to +gapSize/2 degrees around angle 0 before rotation */}
              <path
                d={`M ${50 + 42 * Math.cos((-gapSize / 2) * Math.PI / 180)} ${50 + 42 * Math.sin((-gapSize / 2) * Math.PI / 180)} A 42 42 0 ${gapSize > 180 ? 1 : 0} 1 ${50 + 42 * Math.cos((gapSize / 2) * Math.PI / 180)} ${50 + 42 * Math.sin((gapSize / 2) * Math.PI / 180)}`}
                fill="none"
                stroke="rgba(239, 68, 68, 0.9)"
                strokeWidth="5"
                strokeLinecap="round"
                opacity="0.9"
                style={{
                  transform: "rotate(-90deg)",
                  transformOrigin: "50% 50%",
                }}
              />
              {/* Red indicator dots at gap edges */}
              <circle
                cx={50 + 42 * Math.cos((-gapSize / 2) * Math.PI / 180)}
                cy={50 + 42 * Math.sin((-gapSize / 2) * Math.PI / 180)}
                r="3.5"
                fill="rgba(239, 68, 68, 1)"
                style={{
                  transform: "rotate(-90deg)",
                  transformOrigin: "50% 50%",
                }}
              />
              <circle
                cx={50 + 42 * Math.cos((gapSize / 2) * Math.PI / 180)}
                cy={50 + 42 * Math.sin((gapSize / 2) * Math.PI / 180)}
                r="3.5"
                fill="rgba(239, 68, 68, 1)"
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
          </div>
        </div>

        {/* Exiting & falling flags - fixed overlay (viewport coords) so they don't clip when Top 10 is visible */}
        <div className="fixed inset-0 pointer-events-none z-20">
          {flags.map((f) => {
            if (f.exiting && f.exitX !== undefined && f.exitY !== undefined && f.exitStartTime !== undefined) {
              const exitDuration = 300;
              const elapsed = performance.now() - f.exitStartTime;
              const progress = Math.min(elapsed / exitDuration, 1);
              
              // Smooth easing for exit animation
              const easeOutCubic = 1 - Math.pow(1 - progress, 3);
              // Velocity is in pixels per ms, elapsed is in ms
              const currentExitX = f.exitX + (f.exitVelocityX || 0) * elapsed * easeOutCubic;
              const currentExitY = f.exitY + (f.exitVelocityY || 0) * elapsed * easeOutCubic;
              
              // Scale and rotation during exit for professional effect
              const exitScale = 1 + progress * 0.15; // Slightly grow as it exits (more visible)
              const exitRotation = (f.exitVelocityX || 0) > 0 ? progress * 25 : progress * -25; // Rotate based on direction
              const exitOpacity = 1 - progress * 0.1; // Very slight fade
              
              return (
                <motion.div
                  key={`exiting-${f.id}-${f.eliminatedOrder}`}
                  className="absolute flex items-center justify-center rounded-lg pointer-events-none z-50"
                  style={{
                    width: flagSize,
                    height: flagSize,
                    left: currentExitX,
                    top: currentExitY,
                    transform: `translate(-50%, -50%) rotate(${exitRotation}deg) scale(${exitScale})`,
                    transformOrigin: 'center center',
                    opacity: exitOpacity,
                    transition: 'transform 0.05s linear, opacity 0.05s linear',
                  }}
                  initial={false}
                >
                  {f.country.flag}
                </motion.div>
              );
            }
            return null;
          })}
          {/* Falling flags rendered outside container */}
          {flags.map((f) => {
            if (f.falling && f.fallY !== undefined && f.fallOpacity !== undefined) {
              const container = containerRef.current;
              const containerWidth = container ? container.offsetWidth : 0;
              const containerRect = container ? container.getBoundingClientRect() : null;
              // Use fallX if available (set when flag exits), otherwise convert from container coords to viewport
              let fallX = f.fallX !== undefined 
                ? f.fallX 
                : (containerRect ? containerRect.left : 0) + containerWidth * (cx + f.x * scale);
              
              // Ensure flags stay within viewport
              const screenWidth = window.innerWidth || containerWidth;
              const padding = flagSize / 2;
              fallX = Math.max(padding, Math.min(screenWidth - padding, fallX));
              const stackDelay = f.eliminatedOrder ? (f.eliminatedOrder - 1) * 0.1 : 0;
              
              // Calculate scale based on fall velocity (slight zoom out effect)
              const fallScale = f.stacked ? 1 : Math.max(0.85, 1 - (f.fallVelocity || 0) * 0.1);
              const rotation = f.stacked ? 0 : (f.fallRotation !== undefined ? f.fallRotation : 0); // No rotation when stacked
              const driftX = f.stacked ? 0 : (f.fallDriftX !== undefined ? f.fallDriftX * 20 : 0); // No drift when stacked
              const adjustedFallX = f.stacked ? fallX : fallX + driftX;
              
              return (
                <motion.div
                  key={`falling-${f.id}-${f.eliminatedOrder}`}
                  className="absolute flex items-center justify-center rounded-lg pointer-events-none"
                  style={{
                    width: flagSize,
                    height: flagSize,
                    fontSize: `${emojiSize}px`,
                    left: `${adjustedFallX}px`,
                    top: `${f.fallY}px`,
                    opacity: f.fallOpacity,
                    transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${fallScale})`,
                    transformOrigin: 'center center',
                    transition: f.stacked 
                      ? 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease-out'
                      : 'transform 0.05s linear, opacity 0.1s ease-out',
                    willChange: f.stacked ? 'transform, left, top' : 'transform, opacity',
                  }}
                  initial={false}
                  animate={
                    f.stacked
                      ? {
                          y: [0, -6, 0],
                          scale: [1, 1.03, 1],
                        }
                      : {}
                  }
                  transition={
                    f.stacked
                      ? {
                          duration: 0.8,
                          delay: stackDelay * 0.5, // Reduced delay for smoother appearance
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

        {/* Top 10 winners list - 2 columns with win count, when auto loop is on */}
        {loopEnabled && Object.keys(winnerCounts).length > 0 && (() => {
          const sorted = Object.entries(winnerCounts).sort(([, a], [, b]) => b - a);
          const top10Slice = sorted.slice(0, 10);
          const cutoffWins = top10Slice.length > 0 ? top10Slice[top10Slice.length - 1][1] : 0;
          // Include ties at 10th place only (not when everyone has same count) - cap at 15 to avoid showing all
          const tiesAtCutoff = sorted.slice(10).filter(([, wins]) => wins === cutoffWins && wins > 1);
          const top10Entries = [...top10Slice, ...tiesAtCutoff].slice(0, 15);
          const top10 = top10Entries
            .map(([code, wins]) => ({ country: countries.find((c) => c.code === code), wins }))
            .filter((entry): entry is { country: Country; wins: number } => entry.country != null);
          return (
            <div className="fixed bottom-4 left-0 right-0 z-30 px-3 md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto md:mt-2 md:pb-0 w-full max-w-[min(100vw,100vh)] flex-shrink-0">
              <div className="rounded-xl border border-amber-200/80 dark:border-amber-700/50 bg-amber-50/95 dark:bg-amber-950/80 shadow-md backdrop-blur-sm px-3 py-2 mx-auto max-w-[min(100vw,100vh)]">
                <div className="flex items-center gap-2 mb-1.5 md:mb-2">
                  <span className="text-xs font-semibold text-amber-800 dark:text-amber-200 uppercase tracking-wide">
                    🏆 Top 10 winners
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
                  {top10.map(({ country, wins }, i) => (
                    <div
                      key={`${country.code}-${i}`}
                      className="flex items-center justify-between gap-1.5 rounded-md bg-white/90 dark:bg-gray-800/90 px-1.5 py-0.5 text-xs border border-amber-100 dark:border-amber-800/50"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span>{country.flag}</span>
                        <span className="text-gray-700 dark:text-gray-300 font-medium truncate max-w-[70px] sm:max-w-[90px]">
                          {country.name}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                        {wins} {wins === 1 ? "win" : "wins"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Winner Modal */}
        <Modal
          isOpen={winnerModalOpen}
          onClose={() => setWinnerModalOpen(false)}
          title=""
          size="lg"
          hideHeader
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

            {loopEnabled && nextRoundCountdown !== null && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center py-4"
              >
                <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
                  Next round in
                </p>
                <p className="text-4xl font-bold text-amber-600 dark:text-amber-400 tabular-nums mt-1">
                  {nextRoundCountdown}
                </p>
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
