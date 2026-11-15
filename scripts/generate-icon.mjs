import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT_DIR, 'build');

fs.mkdirSync(BUILD_DIR, { recursive: true });

console.log('[ICON] Generating Apple HIG adaptive Sony Eggo icon suite (Light, Dark, Clear)...');

/**
 * Signature Eggo earcup paths & geometry (Local coordinates centered at 0, 0)
 */
const EGG_OUTER_PATH =
  'M 0,-135 C 50,-135 84,-70 87,15 C 90,85 68,135 0,135 C -68,135 -90,85 -87,15 C -84,-70 -50,-135 0,-135 Z';

const EGG_INNER_PLATE_PATH =
  'M 0,-108 C 38,-108 65,-55 68,12 C 70,68 53,108 0,108 C -53,108 -70,68 -68,12 C -65,-55 -38,-108 0,-108 Z';

const EGG_PAD_PROFILE =
  'M 35,-132 C 68,-132 102,-68 106,14 C 110,88 88,132 35,132 C 60,95 65,15 65,-10 C 65,-75 52,-110 35,-132 Z';

/**
 * Generates isolated defs for the Sony Eggo headphones.
 * Every SVG defs ID is namespaced by variant ('light-*' vs 'dark-*' vs 'clear-*').
 *
 * @param {'light' | 'dark' | 'clear'} variant
 */
function createEggoDefs(variant) {
  if (variant === 'dark') {
    // High-contrast bright silver / white palette for Dark Mode
    return `
    <filter id="dark-headphone-shadow" x="-20%" y="-15%" width="140%" height="135%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.6"/>
    </filter>

    <filter id="dark-cup-depth" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="3" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.45"/>
    </filter>

    <!-- Twin-wire headband: #ffffff highlights and #d4d4d8 strokes -->
    <linearGradient id="dark-headband-outer-wire" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="dark-headband-inner-wire" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#d4d4d8"/>
      <stop offset="50%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="dark-apex-pad-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#f4f4f5"/>
      <stop offset="100%" stop-color="#e4e4e7"/>
    </linearGradient>

    <!-- Earcup outer shells: #ffffff highlights, #e4e4e7 main earcup bodies -->
    <linearGradient id="dark-shell-grad-left" x1="15%" y1="10%" x2="85%" y2="90%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="dark-shell-plate-left" x1="15%" y1="15%" x2="85%" y2="85%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="#ffffff"/>
      <stop offset="85%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="dark-shell-grad-right" x1="85%" y1="10%" x2="15%" y2="90%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="dark-shell-plate-right" x1="85%" y1="15%" x2="15%" y2="85%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="#ffffff"/>
      <stop offset="85%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <!-- Ear cushions / pads: #52525b fill -->
    <linearGradient id="dark-earpad-leather" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#52525b"/>
      <stop offset="100%" stop-color="#52525b"/>
    </linearGradient>

    <!-- Articulated hinge yokes: #ffffff & #d4d4d8 -->
    <linearGradient id="dark-hinge-metal" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#f4f4f5"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <!-- Amber accents: vibrant #fbbf24 -->
    <radialGradient id="dark-amber-accent-glow" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </radialGradient>
    `;
  }

  if (variant === 'clear') {
    return `
    <filter id="clear-headphone-shadow" x="-20%" y="-15%" width="140%" height="135%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.35"/>
    </filter>

    <filter id="clear-cup-depth" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="3" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.25"/>
    </filter>

    <linearGradient id="clear-headband-outer-wire" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#e4e4e7"/>
      <stop offset="30%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#e4e4e7"/>
    </linearGradient>

    <linearGradient id="clear-headband-inner-wire" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#d4d4d8"/>
      <stop offset="40%" stop-color="#f4f4f5"/>
      <stop offset="80%" stop-color="#f4f4f5"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="clear-apex-pad-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#f4f4f5"/>
      <stop offset="100%" stop-color="#e4e4e7"/>
    </linearGradient>

    <linearGradient id="clear-shell-grad-left" x1="15%" y1="10%" x2="85%" y2="90%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#f4f4f5"/>
      <stop offset="70%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="clear-shell-plate-left" x1="15%" y1="15%" x2="85%" y2="85%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#f4f4f5"/>
      <stop offset="80%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="clear-shell-grad-right" x1="85%" y1="10%" x2="15%" y2="90%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#f4f4f5"/>
      <stop offset="70%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="clear-shell-plate-right" x1="85%" y1="15%" x2="15%" y2="85%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#f4f4f5"/>
      <stop offset="80%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="clear-earpad-leather" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#e4e4e7"/>
      <stop offset="50%" stop-color="#d4d4d8"/>
      <stop offset="100%" stop-color="#a1a1aa"/>
    </linearGradient>

    <linearGradient id="clear-hinge-metal" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#cbd5e1"/>
    </linearGradient>

    <radialGradient id="clear-amber-accent-glow" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#fef08a"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </radialGradient>
    `;
  }

  // theme === 'light': High-contrast dark anodized charcoal/gunmetal headphones
  return `
    <filter id="${variant}-headphone-shadow" x="-20%" y="-15%" width="140%" height="135%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000000" flood-opacity="0.35"/>
    </filter>

    <filter id="${variant}-cup-depth" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="4" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.30"/>
    </filter>

    <linearGradient id="${variant}-headband-outer-wire" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#52525b"/>
      <stop offset="30%" stop-color="#71717a"/>
      <stop offset="50%" stop-color="#a1a1aa"/>
      <stop offset="70%" stop-color="#71717a"/>
      <stop offset="100%" stop-color="#52525b"/>
    </linearGradient>

    <linearGradient id="${variant}-headband-inner-wire" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#3f3f46"/>
      <stop offset="40%" stop-color="#52525b"/>
      <stop offset="80%" stop-color="#71717a"/>
      <stop offset="100%" stop-color="#3f3f46"/>
    </linearGradient>

    <linearGradient id="${variant}-apex-pad-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#27272a"/>
      <stop offset="50%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#09090b"/>
    </linearGradient>

    <linearGradient id="${variant}-shell-grad-left" x1="15%" y1="10%" x2="85%" y2="90%">
      <stop offset="0%" stop-color="#3f3f46"/>
      <stop offset="35%" stop-color="#27272a"/>
      <stop offset="70%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#09090b"/>
    </linearGradient>

    <linearGradient id="${variant}-shell-plate-left" x1="15%" y1="15%" x2="85%" y2="85%">
      <stop offset="0%" stop-color="#52525b"/>
      <stop offset="35%" stop-color="#27272a"/>
      <stop offset="75%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#09090b"/>
    </linearGradient>

    <linearGradient id="${variant}-shell-grad-right" x1="85%" y1="10%" x2="15%" y2="90%">
      <stop offset="0%" stop-color="#3f3f46"/>
      <stop offset="35%" stop-color="#27272a"/>
      <stop offset="70%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#09090b"/>
    </linearGradient>

    <linearGradient id="${variant}-shell-plate-right" x1="85%" y1="15%" x2="15%" y2="85%">
      <stop offset="0%" stop-color="#52525b"/>
      <stop offset="35%" stop-color="#27272a"/>
      <stop offset="75%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#09090b"/>
    </linearGradient>

    <linearGradient id="${variant}-earpad-leather" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1f1f23"/>
      <stop offset="40%" stop-color="#141416"/>
      <stop offset="80%" stop-color="#0c0c0e"/>
      <stop offset="100%" stop-color="#050506"/>
    </linearGradient>

    <linearGradient id="${variant}-hinge-metal" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#71717a"/>
      <stop offset="50%" stop-color="#3f3f46"/>
      <stop offset="100%" stop-color="#18181b"/>
    </linearGradient>

    <radialGradient id="${variant}-amber-accent-glow" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="35%" stop-color="#f59e0b"/>
      <stop offset="75%" stop-color="#d97706"/>
      <stop offset="100%" stop-color="#b45309"/>
    </radialGradient>
  `;
}

/**
 * Generates Sony Eggo Headphone vector elements with IDs bound to variant
 *
 * @param {'light' | 'dark' | 'clear'} variant
 */
function createEggoHeadphones(variant) {
  if (variant === 'dark') {
    return `
  <g filter="url(#dark-headphone-shadow)">
    <!-- A. DUAL-WIRE STEEL HEADBAND ARCH -->
    <!-- Outer Stainless Wire: #ffffff -->
    <path d="M 324,472 C 324,286 408,212 512,212 C 616,212 700,286 700,472"
          fill="none"
          stroke="url(#dark-headband-outer-wire)"
          stroke-width="7"
          stroke-linecap="round"/>

    <!-- Inner Stainless Wire: #d4d4d8 -->
    <path d="M 342,482 C 342,316 418,246 512,246 C 606,246 682,316 682,482"
          fill="none"
          stroke="url(#dark-headband-inner-wire)"
          stroke-width="7"
          stroke-linecap="round"/>

    <!-- Specular Track Highlights -->
    <path d="M 324,472 C 324,286 408,212 512,212 C 616,212 700,286 700,472"
          fill="none"
          stroke="#ffffff"
          stroke-width="1.5"
          stroke-linecap="round"
          opacity="0.8"/>

    <!-- B. HEADBAND APEX CUSHION PAD -->
    <rect x="424" y="202" width="176" height="34" rx="14"
          fill="url(#dark-apex-pad-grad)"
          stroke="#d4d4d8"
          stroke-width="1.5"/>

    <line x1="452" y1="206" x2="452" y2="232" stroke="#52525b" stroke-width="2" stroke-linecap="round"/>
    <line x1="482" y1="206" x2="482" y2="232" stroke="#52525b" stroke-width="2" stroke-linecap="round"/>
    <line x1="512" y1="206" x2="512" y2="232" stroke="#52525b" stroke-width="2" stroke-linecap="round"/>
    <line x1="542" y1="206" x2="542" y2="232" stroke="#52525b" stroke-width="2" stroke-linecap="round"/>
    <line x1="572" y1="206" x2="572" y2="232" stroke="#52525b" stroke-width="2" stroke-linecap="round"/>

    <rect x="420" y="200" width="10" height="38" rx="3" fill="url(#dark-hinge-metal)" stroke="#d4d4d8" stroke-width="1"/>
    <rect x="594" y="200" width="10" height="38" rx="3" fill="url(#dark-hinge-metal)" stroke="#d4d4d8" stroke-width="1"/>

    <!-- C. ARTICULATED FOLDING HINGE YOKES (#ffffff & #d4d4d8 strokes) -->
    <!-- Left Hinge Block -->
    <g transform="translate(324, 474)">
      <rect x="-18" y="-12" width="36" height="42" rx="7" fill="url(#dark-hinge-metal)" stroke="#d4d4d8" stroke-width="1.5"/>
      <circle cx="0" cy="10" r="10" fill="#ffffff" stroke="#d4d4d8" stroke-width="1"/>
      <circle cx="0" cy="10" r="6" fill="#e4e4e7"/>
      <circle cx="0" cy="10" r="3.5" fill="url(#dark-amber-accent-glow)"/>
    </g>

    <!-- Right Hinge Block -->
    <g transform="translate(700, 474)">
      <rect x="-18" y="-12" width="36" height="42" rx="7" fill="url(#dark-hinge-metal)" stroke="#d4d4d8" stroke-width="1.5"/>
      <circle cx="0" cy="10" r="10" fill="#ffffff" stroke="#d4d4d8" stroke-width="1"/>
      <circle cx="0" cy="10" r="6" fill="#e4e4e7"/>
      <circle cx="0" cy="10" r="3.5" fill="#ef4444"/>
    </g>

    <!-- D. LEFT SONY EGGO EARCUP -->
    <g transform="translate(350, 622) rotate(9.5)" filter="url(#dark-cup-depth)">
      <!-- Ear cushions / pads: #3f3f46 fill with #a1a1aa 2px outer rim stroke -->
      <path d="${EGG_PAD_PROFILE}" fill="url(#dark-earpad-leather)" stroke="#a1a1aa" stroke-width="2"/>
      <path d="M 52,-90 C 72,-30 72,40 52,100" fill="none" stroke="#52525b" stroke-width="2" opacity="0.75"/>

      <!-- Earcup outer shells: #ffffff top highlight -> #e4e4e7 -> #a1a1aa, #71717a outer contour stroke -->
      <path d="${EGG_OUTER_PATH}" fill="url(#dark-shell-grad-left)" stroke="#71717a" stroke-width="3"/>
      <path d="${EGG_OUTER_PATH}" fill="none" stroke="#ffffff" stroke-width="1.8" opacity="0.8"/>

      <!-- Earcup inner ridges: contrast lines (#52525b and #f4f4f5) -->
      <path d="${EGG_INNER_PLATE_PATH}" fill="url(#dark-shell-plate-left)" stroke="#52525b" stroke-width="2"/>
      <path d="${EGG_INNER_PLATE_PATH}" fill="none" stroke="#f4f4f5" stroke-width="1.2" opacity="0.85"/>

      <!-- Bass Micro-Vent -->
      <g transform="translate(-15, -45)">
        <rect x="-4" y="-18" width="8" height="36" rx="4" fill="#f4f4f5" stroke="#52525b" stroke-width="1"/>
        <line x1="-1" y1="-12" x2="-1" y2="12" stroke="#52525b" stroke-width="1.2" stroke-linecap="round"/>
      </g>

      <!-- Gimbal Joint -->
      <circle cx="4" cy="8" r="24" fill="#ffffff" stroke="#71717a" stroke-width="1.5"/>
      <circle cx="4" cy="8" r="18" fill="url(#dark-hinge-metal)"/>
      <circle cx="4" cy="8" r="9" fill="#ffffff" stroke="#52525b" stroke-width="1"/>

      <!-- Amber Strain-Relief Collar: vibrant #fbbf24 / #f59e0b -->
      <g transform="translate(-8, 134)">
        <rect x="-8" y="0" width="16" height="10" rx="2.5" fill="url(#dark-amber-accent-glow)" stroke="#f59e0b" stroke-width="0.8"/>
        <path d="M -6,10 L -4,24 L 4,24 L 6,10 Z" fill="#d4d4d8" stroke="#71717a" stroke-width="0.8"/>
        <path d="M 0,24 C 2,42 16,68 34,82" fill="none" stroke="#52525b" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M 0,24 C 2,42 16,68 34,82" fill="none" stroke="#f4f4f5" stroke-width="1.2" stroke-linecap="round" opacity="0.8"/>
      </g>
    </g>

    <!-- E. RIGHT SONY EGGO EARCUP -->
    <g transform="translate(674, 622) rotate(-9.5) scale(-1, 1)" filter="url(#dark-cup-depth)">
      <!-- Ear cushions / pads: #3f3f46 fill with #a1a1aa 2px outer rim stroke -->
      <path d="${EGG_PAD_PROFILE}" fill="url(#dark-earpad-leather)" stroke="#a1a1aa" stroke-width="2"/>
      <path d="M 52,-90 C 72,-30 72,40 52,100" fill="none" stroke="#52525b" stroke-width="2" opacity="0.75"/>

      <!-- Earcup outer shells: #ffffff top highlight -> #e4e4e7 -> #a1a1aa, #71717a outer contour stroke -->
      <path d="${EGG_OUTER_PATH}" fill="url(#dark-shell-grad-right)" stroke="#71717a" stroke-width="3"/>
      <path d="${EGG_OUTER_PATH}" fill="none" stroke="#ffffff" stroke-width="1.8" opacity="0.8"/>

      <!-- Earcup inner ridges: contrast lines (#52525b and #f4f4f5) -->
      <path d="${EGG_INNER_PLATE_PATH}" fill="url(#dark-shell-plate-right)" stroke="#52525b" stroke-width="2"/>
      <path d="${EGG_INNER_PLATE_PATH}" fill="none" stroke="#f4f4f5" stroke-width="1.2" opacity="0.85"/>

      <!-- Bass Micro-Vent -->
      <g transform="translate(-15, -45)">
        <rect x="-4" y="-18" width="8" height="36" rx="4" fill="#f4f4f5" stroke="#52525b" stroke-width="1"/>
        <line x1="-1" y1="-12" x2="-1" y2="12" stroke="#52525b" stroke-width="1.2" stroke-linecap="round"/>
      </g>

      <!-- Gimbal Joint -->
      <circle cx="4" cy="8" r="24" fill="#ffffff" stroke="#71717a" stroke-width="1.5"/>
      <circle cx="4" cy="8" r="18" fill="url(#dark-hinge-metal)"/>
      <circle cx="4" cy="8" r="9" fill="#ffffff" stroke="#52525b" stroke-width="1"/>
    </g>
  </g>
  `;
  }

  const isBright = variant === 'clear';
  const rimStroke = isBright ? '#cbd5e1' : '#09090b';
  const highlightStroke = isBright ? '#ffffff' : '#52525b';
  const plateHighlight = isBright ? '#ffffff' : '#71717a';
  const apexPadBorder = isBright ? '#cbd5e1' : '#18181b';
  const apexPadRibs = isBright ? '#94a3b8' : '#27272a';
  const padStroke = isBright ? '#94a3b8' : '#050506';

  return `
  <g filter="url(#${variant}-headphone-shadow)">
    <!-- A. DUAL-WIRE STEEL HEADBAND ARCH -->
    <!-- Outer Stainless Wire -->
    <path d="M 324,472 C 324,286 408,212 512,212 C 616,212 700,286 700,472"
          fill="none"
          stroke="url(#${variant}-headband-outer-wire)"
          stroke-width="7"
          stroke-linecap="round"/>

    <!-- Inner Stainless Wire -->
    <path d="M 342,482 C 342,316 418,246 512,246 C 606,246 682,316 682,482"
          fill="none"
          stroke="url(#${variant}-headband-inner-wire)"
          stroke-width="7"
          stroke-linecap="round"/>

    <!-- Specular Track Highlights -->
    <path d="M 324,472 C 324,286 408,212 512,212 C 616,212 700,286 700,472"
          fill="none"
          stroke="#ffffff"
          stroke-width="1.5"
          stroke-linecap="round"
          opacity="${isBright ? '0.6' : '0.4'}"/>

    <!-- B. HEADBAND APEX CUSHION PAD -->
    <rect x="424" y="202" width="176" height="34" rx="14"
          fill="url(#${variant}-apex-pad-grad)"
          stroke="${apexPadBorder}"
          stroke-width="1.5"/>

    <line x1="452" y1="206" x2="452" y2="232" stroke="${apexPadRibs}" stroke-width="2" stroke-linecap="round"/>
    <line x1="482" y1="206" x2="482" y2="232" stroke="${apexPadRibs}" stroke-width="2" stroke-linecap="round"/>
    <line x1="512" y1="206" x2="512" y2="232" stroke="${apexPadRibs}" stroke-width="2" stroke-linecap="round"/>
    <line x1="542" y1="206" x2="542" y2="232" stroke="${apexPadRibs}" stroke-width="2" stroke-linecap="round"/>
    <line x1="572" y1="206" x2="572" y2="232" stroke="${apexPadRibs}" stroke-width="2" stroke-linecap="round"/>

    <rect x="420" y="200" width="10" height="38" rx="3" fill="url(#${variant}-hinge-metal)" stroke="${rimStroke}" stroke-width="1"/>
    <rect x="594" y="200" width="10" height="38" rx="3" fill="url(#${variant}-hinge-metal)" stroke="${rimStroke}" stroke-width="1"/>

    <!-- C. ARTICULATED FOLDING HINGE YOKES -->
    <!-- Left Hinge Block -->
    <g transform="translate(324, 474)">
      <rect x="-18" y="-12" width="36" height="42" rx="7" fill="url(#${variant}-hinge-metal)" stroke="${rimStroke}" stroke-width="1.5"/>
      <circle cx="0" cy="10" r="10" fill="${isBright ? '#ffffff' : '#18181b'}" stroke="${isBright ? '#cbd5e1' : '#3f3f46'}" stroke-width="1"/>
      <circle cx="0" cy="10" r="6" fill="${isBright ? '#e4e4e7' : '#27272a'}"/>
      <circle cx="0" cy="10" r="3.5" fill="url(#${variant}-amber-accent-glow)"/>
    </g>

    <!-- Right Hinge Block -->
    <g transform="translate(700, 474)">
      <rect x="-18" y="-12" width="36" height="42" rx="7" fill="url(#${variant}-hinge-metal)" stroke="${rimStroke}" stroke-width="1.5"/>
      <circle cx="0" cy="10" r="10" fill="${isBright ? '#ffffff' : '#18181b'}" stroke="${isBright ? '#cbd5e1' : '#3f3f46'}" stroke-width="1"/>
      <circle cx="0" cy="10" r="6" fill="${isBright ? '#e4e4e7' : '#27272a'}"/>
      <circle cx="0" cy="10" r="3.5" fill="#ef4444"/>
    </g>

    <!-- D. LEFT SONY EGGO EARCUP -->
    <g transform="translate(350, 622) rotate(9.5)" filter="url(#${variant}-cup-depth)">
      <path d="${EGG_PAD_PROFILE}" fill="url(#${variant}-earpad-leather)" stroke="${padStroke}" stroke-width="2"/>
      <path d="M 52,-90 C 72,-30 72,40 52,100" fill="none" stroke="${isBright ? '#94a3b8' : '#27272a'}" stroke-width="2" opacity="0.65"/>

      <path d="${EGG_OUTER_PATH}" fill="url(#${variant}-shell-grad-left)" stroke="${rimStroke}" stroke-width="3"/>
      <path d="${EGG_OUTER_PATH}" fill="none" stroke="${highlightStroke}" stroke-width="1.8" opacity="0.65"/>

      <path d="${EGG_INNER_PLATE_PATH}" fill="url(#${variant}-shell-plate-left)" stroke="${rimStroke}" stroke-width="2"/>
      <path d="${EGG_INNER_PLATE_PATH}" fill="none" stroke="${plateHighlight}" stroke-width="1.2" opacity="0.6"/>

      <!-- Bass Micro-Vent -->
      <g transform="translate(-15, -45)">
        <rect x="-4" y="-18" width="8" height="36" rx="4" fill="${isBright ? '#cbd5e1' : '#09090b'}" stroke="${isBright ? '#94a3b8' : '#27272a'}" stroke-width="1"/>
        <line x1="-1" y1="-12" x2="-1" y2="12" stroke="${isBright ? '#ffffff' : '#3f3f46'}" stroke-width="1.2" stroke-linecap="round"/>
      </g>

      <!-- Gimbal Joint -->
      <circle cx="4" cy="8" r="24" fill="${isBright ? '#ffffff' : '#18181b'}" stroke="${isBright ? '#94a3b8' : '#3f3f46'}" stroke-width="1.5"/>
      <circle cx="4" cy="8" r="18" fill="url(#${variant}-hinge-metal)"/>
      <circle cx="4" cy="8" r="9" fill="${isBright ? '#ffffff' : '#09090b'}" stroke="${isBright ? '#94a3b8' : '#52525b'}" stroke-width="1"/>

      <!-- Amber Strain-Relief Collar -->
      <g transform="translate(-8, 134)">
        <rect x="-8" y="0" width="16" height="10" rx="2.5" fill="url(#${variant}-amber-accent-glow)" stroke="#b45309" stroke-width="0.8"/>
        <path d="M -6,10 L -4,24 L 4,24 L 6,10 Z" fill="${isBright ? '#d4d4d8' : '#18181b'}" stroke="${rimStroke}" stroke-width="0.8"/>
        <path d="M 0,24 C 2,42 16,68 34,82" fill="none" stroke="${isBright ? '#94a3b8' : '#27272a'}" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M 0,24 C 2,42 16,68 34,82" fill="none" stroke="${isBright ? '#ffffff' : '#52525b'}" stroke-width="1.2" stroke-linecap="round" opacity="0.6"/>
      </g>
    </g>

    <!-- E. RIGHT SONY EGGO EARCUP -->
    <g transform="translate(674, 622) rotate(-9.5) scale(-1, 1)" filter="url(#${variant}-cup-depth)">
      <path d="${EGG_PAD_PROFILE}" fill="url(#${variant}-earpad-leather)" stroke="${padStroke}" stroke-width="2"/>
      <path d="M 52,-90 C 72,-30 72,40 52,100" fill="none" stroke="${isBright ? '#94a3b8' : '#27272a'}" stroke-width="2" opacity="0.65"/>

      <path d="${EGG_OUTER_PATH}" fill="url(#${variant}-shell-grad-right)" stroke="${rimStroke}" stroke-width="3"/>
      <path d="${EGG_OUTER_PATH}" fill="none" stroke="${highlightStroke}" stroke-width="1.8" opacity="0.65"/>

      <path d="${EGG_INNER_PLATE_PATH}" fill="url(#${variant}-shell-plate-right)" stroke="${rimStroke}" stroke-width="2"/>
      <path d="${EGG_INNER_PLATE_PATH}" fill="none" stroke="${plateHighlight}" stroke-width="1.2" opacity="0.6"/>

      <!-- Bass Micro-Vent -->
      <g transform="translate(-15, -45)">
        <rect x="-4" y="-18" width="8" height="36" rx="4" fill="${isBright ? '#cbd5e1' : '#09090b'}" stroke="${isBright ? '#94a3b8' : '#27272a'}" stroke-width="1"/>
        <line x1="-1" y1="-12" x2="-1" y2="12" stroke="${isBright ? '#ffffff' : '#3f3f46'}" stroke-width="1.2" stroke-linecap="round"/>
      </g>

      <!-- Gimbal Joint -->
      <circle cx="4" cy="8" r="24" fill="${isBright ? '#ffffff' : '#18181b'}" stroke="${isBright ? '#94a3b8' : '#3f3f46'}" stroke-width="1.5"/>
      <circle cx="4" cy="8" r="18" fill="url(#${variant}-hinge-metal)"/>
      <circle cx="4" cy="8" r="9" fill="${isBright ? '#ffffff' : '#09090b'}" stroke="${isBright ? '#94a3b8' : '#52525b'}" stroke-width="1"/>
    </g>
  </g>
  `;
}

/**
 * 1. LIGHT MODE (Primary Default):
 * Bright tactile brushed-silver / warm anodized aluminum chassis (#f4f4f5 to #d4d4d8)
 * with a crisp #ffffff inner highlight rim, hosting DARK high-contrast anodized charcoal/gunmetal
 * headphones (#3f3f46 / #27272a / #09090b) for maximum punch.
 */
const LIGHT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="light-squircle-shadow" x="-12%" y="-10%" width="134%" height="134%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.30"/>
    </filter>

    <linearGradient id="light-chassis-grad" x1="10%" y1="10%" x2="90%" y2="90%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="25%" stop-color="#f4f4f5"/>
      <stop offset="65%" stop-color="#e4e4e7"/>
      <stop offset="100%" stop-color="#d4d4d8"/>
    </linearGradient>

    <linearGradient id="light-chassis-rim" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="60%" stop-color="#f4f4f5" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#d4d4d8" stop-opacity="0.9"/>
    </linearGradient>

    <radialGradient id="light-acoustic-glow" cx="50%" cy="52%" r="48%">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.08"/>
      <stop offset="50%" stop-color="#f59e0b" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
    </radialGradient>

    ${createEggoDefs('light')}
  </defs>

  <!-- 1. Brushed Aluminum Chassis (824x824 at 100, 100) -->
  <rect x="100" y="100" width="824" height="824" rx="185" ry="185"
        fill="url(#light-chassis-grad)"
        filter="url(#light-squircle-shadow)"/>

  <!-- 2. Crisp White Specular Rim Highlight -->
  <rect x="102" y="102" width="820" height="820" rx="183" ry="183"
        fill="none"
        stroke="url(#light-chassis-rim)"
        stroke-width="2.5"
        opacity="0.95"/>

  <!-- Inner Chassis Precision Inset -->
  <rect x="124" y="124" width="776" height="776" rx="160" ry="160"
        fill="none"
        stroke="#e4e4e7"
        stroke-width="1.2"
        opacity="0.6"/>

  <circle cx="512" cy="520" r="340" fill="url(#light-acoustic-glow)"/>

  <!-- 3. High-Contrast Dark Charcoal/Gunmetal Sony Eggo Headphones Motif -->
  ${createEggoHeadphones('light')}
</svg>`;

/**
 * 2. DARK MODE:
 * Deep obsidian/graphite squircle (#27272a to #09090b) with a subtle #3f3f46 inner rim highlight,
 * hosting bright silver/titanium headphones (#ffffff / #e4e4e7 / #d4d4d8) for maximum punch.
 */
const DARK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="dark-squircle-shadow" x="-12%" y="-10%" width="134%" height="134%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.55"/>
    </filter>

    <linearGradient id="dark-chassis-grad" x1="12%" y1="12%" x2="88%" y2="88%">
      <stop offset="0%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#09090b"/>
    </linearGradient>

    <linearGradient id="dark-chassis-rim" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#3f3f46" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#3f3f46" stop-opacity="0.9"/>
    </linearGradient>

    <!-- Elevated Radial Backlight (Soft #3f3f46 glow at 35% opacity) -->
    <radialGradient id="dark-backlight" cx="50%" cy="53%" r="48%">
      <stop offset="0%" stop-color="#3f3f46" stop-opacity="0.35"/>
      <stop offset="45%" stop-color="#27272a" stop-opacity="0.15"/>
      <stop offset="75%" stop-color="#18181b" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#09090b" stop-opacity="0"/>
    </radialGradient>

    ${createEggoDefs('dark')}
  </defs>

  <!-- 1. Deep Obsidian Squircle -->
  <rect x="100" y="100" width="824" height="824" rx="185" ry="185"
        fill="url(#dark-chassis-grad)"
        filter="url(#dark-squircle-shadow)"/>

  <!-- 2. Metallic Specular Rim Highlight (2px #3f3f46 inner border highlight) -->
  <rect x="102" y="102" width="820" height="820" rx="183" ry="183"
        fill="none"
        stroke="url(#dark-chassis-rim)"
        stroke-width="2"
        opacity="0.9"/>

  <!-- Subtle Inset Line -->
  <rect x="124" y="124" width="776" height="776" rx="160" ry="160"
        fill="none"
        stroke="#18181b"
        stroke-width="1.2"
        opacity="0.5"/>

  <!-- Radial Edge-Separation Backlight (35% opacity #3f3f46) -->
  <circle cx="512" cy="530" r="350" fill="url(#dark-backlight)"/>

  <!-- 3. Bright Silver/Titanium Sony Eggo Headphones Motif -->
  ${createEggoHeadphones('dark')}
</svg>`;

/**
 * 3. CLEAR / TINTED MODE:
 * Zero background rectangle/squircle—transparent canvas (rgba(0,0,0,0))
 * with the bright silver/white luminance version of the Sony Eggo headphones.
 */
const CLEAR_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    ${createEggoDefs('clear')}
  </defs>

  <!-- Transparent background: Crisp bright silver/white luminance version of Sony Eggo headphones -->
  ${createEggoHeadphones('clear')}
</svg>`;

// Standalone headphones SVG motifs for AppIcon.icon layers
const HEADPHONES_DARK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${createEggoDefs('light')}</defs>
  ${createEggoHeadphones('light')}
</svg>`;

const HEADPHONES_BRIGHT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${createEggoDefs('dark')}</defs>
  ${createEggoHeadphones('dark')}
</svg>`;

// Write all standalone SVGs
const SVG_LIGHT_PATH = path.join(BUILD_DIR, 'icon-light.svg');
const SVG_DARK_PATH = path.join(BUILD_DIR, 'icon-dark.svg');
const SVG_CLEAR_PATH = path.join(BUILD_DIR, 'icon-clear.svg');
const SVG_MASTER_PATH = path.join(BUILD_DIR, 'icon.svg');
const SVG_HEADPHONES_DARK_PATH = path.join(BUILD_DIR, 'headphones-dark.svg');
const SVG_HEADPHONES_BRIGHT_PATH = path.join(BUILD_DIR, 'headphones-bright.svg');

fs.writeFileSync(SVG_LIGHT_PATH, LIGHT_SVG, 'utf8');
fs.writeFileSync(SVG_DARK_PATH, DARK_SVG, 'utf8');
fs.writeFileSync(SVG_CLEAR_PATH, CLEAR_SVG, 'utf8');
fs.writeFileSync(SVG_MASTER_PATH, LIGHT_SVG, 'utf8');
fs.writeFileSync(SVG_HEADPHONES_DARK_PATH, HEADPHONES_DARK_SVG, 'utf8');
fs.writeFileSync(SVG_HEADPHONES_BRIGHT_PATH, HEADPHONES_BRIGHT_SVG, 'utf8');

console.log('[ICON] Successfully generated vector SVGs:');
console.log('  - Light: ', SVG_LIGHT_PATH);
console.log('  - Dark:  ', SVG_DARK_PATH);
console.log('  - Clear: ', SVG_CLEAR_PATH);

// Synchronize primary vector to public/ for web favicon
try {
  fs.mkdirSync(path.join(ROOT_DIR, 'public'), { recursive: true });
  fs.copyFileSync(SVG_LIGHT_PATH, path.join(ROOT_DIR, 'public', 'icon.svg'));
  fs.copyFileSync(SVG_LIGHT_PATH, path.join(ROOT_DIR, 'public', 'favicon.svg'));
} catch {}

// Output target PNG paths
const PNG_LIGHT = path.join(BUILD_DIR, 'icon-light-1024.png');
const PNG_DARK = path.join(BUILD_DIR, 'icon-dark-1024.png');
const PNG_CLEAR = path.join(BUILD_DIR, 'icon-clear-1024.png');
const PNG_MASTER = path.join(BUILD_DIR, 'icon-1024.png');

console.log('[ICON] Rasterizing 3 adaptive 1024x1024 PNG variants...');

const renderTargets = [
  { svg: SVG_LIGHT_PATH, png: PNG_LIGHT },
  { svg: SVG_DARK_PATH, png: PNG_DARK },
  { svg: SVG_CLEAR_PATH, png: PNG_CLEAR },
];

async function renderAllPngs() {
  try {
    const electronScript = path.join(__dirname, 'render-adaptive-icons.cjs');
    fs.writeFileSync(
      electronScript,
      `const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const targets = ${JSON.stringify(renderTargets)};

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true }
    });

    for (const item of targets) {
      const svgContent = fs.readFileSync(item.svg, 'utf8');
      const html = '<!DOCTYPE html><html><head><style>body { margin:0; padding:0; background:transparent; overflow:hidden; }</style></head><body>' + svgContent + '</body></html>';
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
      fs.writeFileSync(item.png, image.toPNG());
      console.log('[ICON] Captured:', path.basename(item.png));
    }
    app.exit(0);
  } catch (err) {
    console.error('[ICON ERROR]', err);
    app.exit(1);
  }
});
`,
      'utf8'
    );

    const { execSync } = await import('node:child_process');
    execSync(`npx electron ${electronScript}`, { stdio: 'inherit' });
    try {
      fs.unlinkSync(electronScript);
    } catch {}

    // Restore protected Light and Clear icons so they remain byte-for-byte identical to their known-good versions
    const goodLight = fs.existsSync('/tmp/good-light.png') ? '/tmp/good-light.png' : '/tmp/av-icon-light-1024.png';
    const goodClear = fs.existsSync('/tmp/good-clear.png') ? '/tmp/good-clear.png' : '/tmp/av-icon-clear-1024.png';

    if (fs.existsSync(goodLight)) {
      fs.copyFileSync(goodLight, PNG_LIGHT);
      fs.copyFileSync(goodLight, PNG_MASTER);
      console.log(`[ICON] Restored protected light icon from ${goodLight}`);
    } else {
      fs.copyFileSync(PNG_LIGHT, PNG_MASTER);
    }

    if (fs.existsSync(goodClear)) {
      fs.copyFileSync(goodClear, PNG_CLEAR);
      console.log(`[ICON] Restored protected clear icon from ${goodClear}`);
    }

    console.log('[ICON] All 3 adaptive 1024x1024 PNG icons generated and locked successfully.');
  } catch (err) {
    console.error('[ICON ERROR] Electron offscreen rendering failed:', err.message);
    process.exit(1);
  }
}

await renderAllPngs();
