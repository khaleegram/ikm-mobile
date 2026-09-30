#!/usr/bin/env node
/**
 * Generates the ChatCart brand mark in every size and format the app and the
 * marketing site need. Requires ImageMagick 7 (`magick`) on PATH.
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * The mark is the ChatCart shopping bag — the logo the website already used. A
 * white bag on an ink #17211f tile, which is exactly the treatment in the site
 * header. The geometry below is the single source of truth; every PNG is
 * rasterised from it, so the app icon, the favicon, the splash screen and the
 * website navbar can never drift apart.
 *
 * The wordmark font is resolved from the first readable path in FONT_CANDIDATES,
 * or CHATCART_FONT if set. Only the Open Graph image uses text — every icon is
 * pure vector geometry and has no font dependency at all.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");
const SITE_ROOT = process.env.CHATCART_SITE_DIR
  ? resolve(process.env.CHATCART_SITE_DIR)
  : resolve(APP_ROOT, "../chatcart-website");

/* ------------------------------------------------------------------ *
 * Brand constants — must match the theme tokens in the site's globals.css
 * and the lightBrown value in components/auth/auth-login-screen.tsx.
 * ------------------------------------------------------------------ */
const BROWN = "#A67C52";
const BROWN_LIGHT = "#C49A6C";
const INK = "#17211f";

/**
 * Background behind the brand mark on launcher and store icons.
 *
 * Brown, not ink. The mark ships as a white bag on the brand brown — the same treatment as the
 * brown identity circle on the sign-in screen and the brown pill in the profile header. Ink stays
 * for the website surfaces (favicon, page background), where the mark sits on a dark page.
 *
 * Named rather than inlined so the app icon can never quietly drift back to a different colour
 * from the rest of the brand.
 */
const ICON_BG = BROWN;

const WHITE = "#FFFFFF";

/* ------------------------------------------------------------------ *
 * The mark
 *
 * The ChatCart shopping bag, taken from the website's header logo. It is the
 * lucide "ShoppingBag" glyph: three stroked paths on a 24x24 grid, not a filled
 * shape — the bag is line art, so it needs a stroke and no fill to render
 * correctly. Keeping the original path data means the app icon is pixel-for-
 * pixel the mark the website already shows, rather than a redrawn imitation.
 * ------------------------------------------------------------------ */
const MARK_VIEWBOX = "0 0 24 24";
const MARK_STROKE_WIDTH = 2;
const MARK_PATHS = [
  // Bag body
  "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z",
  // Fold line across the top
  "M3 6h18",
  // Handle
  "M16 10a4 4 0 0 1-8 0",
];

/**
 * Where the ink actually sits inside the 24x24 viewBox, including the stroke.
 * The bag spans x 3..21 and y 2..22, so once the stroke is added the artwork
 * covers 20x22 of the 24 box. Every size below is expressed as a fraction of
 * the canvas and gets multiplied by this, which is what stops the bag from
 * looking under-sized on the tiles.
 */
const MARK_INK = { width: 20 / 24, height: 22 / 24 };

/**
 * Wraps the mark in a square canvas, scaled so the drawn artwork covers
 * `fillRatio` of the canvas width.
 *
 * The bag is line art, so the paths are stroked and not filled. The stroke is
 * scaled by the same transform as the paths, so it stays proportional at every
 * size and matches lucide's own 2/24 ratio — the app icon is the website mark
 * at a larger size, not a bolder redraw.
 */
function composedSvg({ size, fillRatio, color, background, cornerRadius = 0, strokeWidth = MARK_STROKE_WIDTH }) {
  const glyphWidth = (size * fillRatio) / MARK_INK.width;
  const scale = glyphWidth / 24;
  const offset = size / 2;
  const bg = background
    ? `<rect width="${size}" height="${size}" rx="${cornerRadius}" fill="${background}"/>`
    : "";
  const paths = MARK_PATHS.map(
    (d) =>
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${bg}<g transform="translate(${offset} ${offset}) scale(${scale.toFixed(5)}) translate(-12 -12)">${paths}</g>
</svg>
`;
}

/* ------------------------------------------------------------------ *
 * SVG deliverables written verbatim (no rasterising needed)
 * ------------------------------------------------------------------ */

const SVGS = [
  {
    // Bare mark in ink. For light backgrounds: on paper, in the site header
    // when no tile is wanted.
    path: join(APP_ROOT, "assets/brand/logo-mark.svg"),
    contents: composedSvg({ size: 24, fillRatio: 1, color: INK }),
  },
  {
    // Bare mark in white, for dark backgrounds.
    path: join(APP_ROOT, "assets/brand/logo-mark-white.svg"),
    contents: composedSvg({ size: 24, fillRatio: 1, color: WHITE }),
  },
  {
    // The tile lockup: white mark on the ink rounded square, which is the exact
    // shape the website header renders.
    path: join(APP_ROOT, "assets/brand/logo-tile.svg"),
    contents: composedSvg({
      size: 1024,
      fillRatio: 0.62,
      color: WHITE,
      background: INK,
      cornerRadius: 230,
    }),
  },
];

/* ------------------------------------------------------------------ *
 * Rasterised deliverables
 *
 * `fillRatio` is the drawn artwork's width as a fraction of the canvas. The
 * values differ per platform rather than being reused blindly, and they are
 * deliberately larger than the storefront's were: the bag is a tall, narrow
 * glyph (its ink is 20x22 of the 24 box), so a given ratio covers less of the
 * canvas and the bag reads smaller than a similarly-proportioned shape would.
 *  - Store icons want a confident mark, ~0.62 of the canvas width.
 *  - Android adaptive foregrounds must stay inside the central safe zone or
 *    the launcher mask clips them. The bag's ink is 1.1x taller than it is
 *    wide, so height is the binding constraint: 0.55 puts the ink at ~65dp
 *    inside the 66dp safe circle, which is as large as it can safely go.
 *    Below that the line art stops reading as a bag once the launcher draws
 *    it at 100px, which is how it shipped at 0.44.
 *  - Notification icons are drawn small by the system, so they get 0.76.
 *
 * Icons also take a slightly heavier stroke than the website mark. The true
 * 2-unit stroke is right where the mark is seen large — the site header, the
 * splash screen — but at launcher size its hairlines anti-alias away and the
 * bag turns into a smudge. The bump is optical correction for small sizes,
 * not a change to the mark itself.
 * ------------------------------------------------------------------ */

const PNGS = [
  // --- App icons and Android adaptive layers ---
  {
    path: join(APP_ROOT, "assets/brand/app-icon.png"),
    size: 1024,
    fillRatio: 0.62,
    strokeWidth: 2.3,
    color: WHITE,
    background: ICON_BG,
    flatten: ICON_BG,
    note: "App store + iOS icon. Full bleed and opaque: iOS masks and rejects alpha.",
  },
  {
    path: join(APP_ROOT, "assets/brand/adaptive-icon-foreground.png"),
    size: 1024,
    fillRatio: 0.55,
    strokeWidth: 2.4,
    color: WHITE,
    background: null,
    note: "Android adaptive foreground. Transparent; sits on backgroundColor.",
  },
  {
    path: join(APP_ROOT, "assets/brand/adaptive-icon-monochrome.png"),
    size: 1024,
    fillRatio: 0.55,
    strokeWidth: 2.4,
    color: WHITE,
    background: null,
    note: "Android 13+ themed icon. White on transparent; the system tints it.",
  },
  {
    path: join(APP_ROOT, "assets/brand/splash-icon.png"),
    size: 1024,
    fillRatio: 0.62,
    color: WHITE,
    background: null,
    note: "Splash mark. Sits on the ink splash background.",
  },
  {
    path: join(APP_ROOT, "assets/brand/notification-icon.png"),
    size: 96,
    fillRatio: 0.76,
    color: WHITE,
    background: null,
    note: "Android notification icon. Must be white on transparent.",
  },

  // --- Expo web output ---
  //
  // The browser favicons take a slightly heavier stroke than the source mark.
  // At 16px the bag's 2-unit stroke lands on ~1.4 device pixels, which
  // anti-aliases into a muddy grey outline against the ink tile; thickening it
  // to 2.6 keeps the bag legible in a tab. This is the standard optical
  // adjustment for tiny sizes, not a change to the mark itself — every icon
  // from 48px up uses the true 2-unit stroke.
  {
    path: join(APP_ROOT, "assets/web/favicon-16x16.png"),
    size: 16,
    fillRatio: 0.92,
    strokeWidth: 2.8,
    color: WHITE,
    background: INK,
    cornerRadius: 3,
  },
  {
    path: join(APP_ROOT, "assets/web/favicon-32x32.png"),
    size: 32,
    fillRatio: 0.88,
    strokeWidth: 2.4,
    color: WHITE,
    background: INK,
    cornerRadius: 6,
  },
  {
    path: join(APP_ROOT, "assets/web/favicon-48x48.png"),
    size: 48,
    fillRatio: 0.86,
    color: WHITE,
    background: INK,
    cornerRadius: 9,
  },
  {
    path: join(APP_ROOT, "assets/web/favicon-64x64.png"),
    size: 64,
    fillRatio: 0.82,
    color: WHITE,
    background: INK,
    cornerRadius: 12,
  },
  {
    path: join(APP_ROOT, "assets/web/favicon-96x96.png"),
    size: 96,
    fillRatio: 0.78,
    color: WHITE,
    background: INK,
    cornerRadius: 20,
  },
  {
    path: join(APP_ROOT, "assets/web/favicon-128x128.png"),
    size: 128,
    fillRatio: 0.76,
    color: WHITE,
    background: INK,
    cornerRadius: 26,
  },
  {
    path: join(APP_ROOT, "assets/web/apple-touch-icon.png"),
    size: 180,
    fillRatio: 0.58,
    color: WHITE,
    background: INK,
    flatten: INK,
    note: "iOS home screen. Opaque, unmasked, so iOS applies its own rounding.",
  },
  {
    path: join(APP_ROOT, "assets/web/icon-192x192.png"),
    size: 192,
    fillRatio: 0.44,
    color: WHITE,
    background: INK,
    flatten: INK,
    note: "PWA icon. Sized for the 66% safe circle so a circular mask cannot clip it.",
  },
  {
    path: join(APP_ROOT, "assets/web/icon-384x384.png"),
    size: 384,
    fillRatio: 0.44,
    color: WHITE,
    background: INK,
    flatten: INK,
  },
  {
    path: join(APP_ROOT, "assets/web/icon-512x512.png"),
    size: 512,
    fillRatio: 0.44,
    color: WHITE,
    background: INK,
    flatten: INK,
  },
];

/* ------------------------------------------------------------------ *
 * Marketing site deliverables
 * ------------------------------------------------------------------ */

const SITE_PNGS = [
  {
    dir: "src/app",
    name: "apple-icon.png",
    size: 180,
    fillRatio: 0.58,
    background: INK,
    cornerRadius: 0,
    flatten: INK,
  },
  {
    dir: "src/app",
    name: "icon.png",
    size: 512,
    fillRatio: 0.58,
    background: INK,
    cornerRadius: 0,
    flatten: INK,
  },
];

/* ------------------------------------------------------------------ *
 * Icons for the Next.js App Router
 *
 * A rounded tile for icon.svg (browsers render SVG favicons at any size, so the
 * tile reads better than a bare glyph), and a square for apple-icon.png because
 * iOS applies its own rounding.
 * ------------------------------------------------------------------ */

function siteIconSvg() {
  return composedSvg({
    size: 512,
    fillRatio: 0.58,
    color: WHITE,
    background: INK,
    cornerRadius: 116,
  });
}

function siteMaskableSvg() {
  return composedSvg({
    size: 512,
    fillRatio: 0.44,
    color: WHITE,
    background: INK,
  });
}

/* ------------------------------------------------------------------ *
 * Open Graph card, 1200x630
 * ------------------------------------------------------------------ */

const FONT_CANDIDATES = [
  process.env.CHATCART_FONT,
  join(
    APP_ROOT,
    "node_modules/expo-dev-menu/android/src/main/res/font/inter_bold.ttf"
  ),
  "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Bold.ttf",
  "/usr/share/fonts/google-noto/NotoSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
].filter(Boolean);

function findFont() {
  for (const candidate of FONT_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Rasteriser
 * ------------------------------------------------------------------ */

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function magick(args) {
  return run("magick", args);
}

function rasteriseFromString(svg, outPath, size, { flatten = null } = {}) {
  mkdirSync(dirname(outPath), { recursive: true });

  const args = [
    "-background",
    "none",
    "-density",
    "384",
    "svg:-",
    "-resize",
    `${size}x${size}`,
  ];

  // iOS rejects app icons and home-screen icons that carry an alpha channel, so
  // those are flattened onto the brand brown rather than merely having opaque
  // pixels. The Android adaptive, splash and notification layers keep their
  // transparency by design — they sit on a background the OS controls.
  if (flatten) {
    args.push("-background", flatten, "-alpha", "remove", "-alpha", "off");
  }

  // Flattened icons must end up as PNG24 — writing PNG32 would re-introduce the
  // alpha channel that iOS rejects. Transparent layers are written PNG32 so
  // ImageMagick cannot silently downgrade pure white+alpha to greyscale.
  args.push("-strip", flatten ? `PNG24:${outPath}` : `PNG32:${outPath}`);

  // ImageMagick reads from stdin via the magic "svg:-" filename, so the SVG
  // never touches disk.
  execFileSync("magick", args, { input: svg, stdio: ["pipe", "pipe", "pipe"] });
}

/* ------------------------------------------------------------------ *
 * Expo web boilerplate
 *
 * Both of these shipped with the appicon.online defaults — a white theme
 * colour and a manifest naming the app "My App" / "App". Regenerated here so
 * the Expo web build and the marketing site describe the same brand.
 * ------------------------------------------------------------------ */

const HEAD_SNIPPET = `<!-- ChatCart favicon & PWA icons — generated by scripts/generate-brand-assets.mjs -->
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="${BROWN}">
`;

const WEB_MANIFEST = `${JSON.stringify(
  {
    name: "ChatCart",
    short_name: "ChatCart",
    description:
      "Social commerce marketplace for Nigeria: agree the price in chat and pay into escrow.",
    start_url: "/",
    display: "standalone",
    icons: [
      { src: "favicon-96x96.png", sizes: "96x96", type: "image/png", purpose: "any" },
      { src: "icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icon-384x384.png", sizes: "384x384", type: "image/png", purpose: "any" },
      { src: "icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
    theme_color: BROWN,
    background_color: "#ffffff",
  },
  null,
  2
)}\n`;

/* ------------------------------------------------------------------ *
 * Generated path module
 *
 * The app's React Native logo and the website's logo both import this rather
 * than hard-coding the path, so a change to the geometry above can never leave
 * the in-app mark and the icon files showing different artwork.
 * ------------------------------------------------------------------ */

function markModule() {
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by scripts/generate-brand-assets.mjs from the ChatCart shopping bag
 * — the logo the website uses. The same geometry generates the app icon, the
 * favicons and the splash screen, so run \`node scripts/generate-brand-assets.mjs\`
 * after changing it, in the repository that owns the script.
 *
 * The bag is line art, not a filled shape: these paths are drawn on a 24x24
 * grid and must be rendered with a ${MARK_STROKE_WIDTH}-unit stroke, no fill, and round
 * caps and joins. Scaling the viewBox scales the stroke with it, so the mark
 * keeps the same weight as the website's own icon at any size.
 */

export const BRAND_MARK_PATHS = ${JSON.stringify(MARK_PATHS, null, 2)} as const;

export const BRAND_VIEWBOX = "${MARK_VIEWBOX}";

export const BRAND_STROKE_WIDTH = ${MARK_STROKE_WIDTH};

export const BRAND_BROWN = "${BROWN}";
export const BRAND_BROWN_LIGHT = "${BROWN_LIGHT}";
export const BRAND_INK = "${INK}";
`;
}

const MODULE_TARGETS = [join(APP_ROOT, "lib/brand/mark-path.ts")];

/**
 * Refreshes the exported icon sets that previous tooling left in the repo.
 *
 * None of these are read by Expo — EAS derives the real native icons from
 * `app.json` at prebuild time. They are left over from a manual export, and
 * every one of them still showed the old artwork. Two reasons to regenerate
 * rather than delete: the Play Store listing image is uploaded by hand, so a
 * stale file there is a stale logo in the store; and a folder of the old mark
 * sitting next to the new one is exactly how the wrong asset gets shipped.
 */
function regenerateIconExports(written) {
  // 1. iOS asset catalogue. Sizes come from Contents.json so the set stays
  //    valid even if Apple changes the required list.
  const appIconDir = join(APP_ROOT, "assets/AppIcon.appiconset");
  const contentsPath = join(appIconDir, "Contents.json");
  if (existsSync(contentsPath)) {
    const contents = JSON.parse(readFileSync(contentsPath, "utf8"));
    for (const entry of contents.images ?? []) {
      if (!entry.filename || !entry.size) continue;
      const base = Number.parseFloat(String(entry.size).split("x")[0]);
      const scale = Number.parseFloat(String(entry.scale ?? "1x").replace("x", "")) || 1;
      const px = Math.round(base * scale);
      if (!Number.isFinite(px) || px <= 0) continue;
      const out = join(appIconDir, entry.filename);
      rasteriseFromString(
        composedSvg({ size: px, fillRatio: 0.62, strokeWidth: 2.3, color: WHITE, background: ICON_BG }),
        out,
        px,
        { flatten: ICON_BG }
      );
      written.push(out);
    }
  }

  // 2. Android launcher densities, at the sizes Android actually expects.
  const MIPMAPS = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
  };
  for (const [dir, size] of Object.entries(MIPMAPS)) {
    const out = join(APP_ROOT, "assets/android", dir, "ChatCart.png");
    if (!existsSync(dirname(out))) continue;
    rasteriseFromString(
      composedSvg({ size, fillRatio: 0.62, strokeWidth: 2.3, color: WHITE, background: ICON_BG }),
      out,
      size,
      { flatten: ICON_BG }
    );
    written.push(out);
  }

  // 3. Play Store listing icon — 512x512 is Google's required size.
  const playStore = join(APP_ROOT, "assets/android/playstore/ChatCart.png");
  if (existsSync(dirname(playStore))) {
    rasteriseFromString(
      composedSvg({ size: 512, fillRatio: 0.62, strokeWidth: 2.3, color: WHITE, background: ICON_BG }),
      playStore,
      512,
      { flatten: ICON_BG }
    );
    written.push(playStore);
  }

  // 4. The Expo template's default image set.
  const LEGACY_IMAGES = [
    { name: "icon.png", size: 1024, fillRatio: 0.62, strokeWidth: 2.3, background: ICON_BG, flatten: ICON_BG },
    { name: "splash-icon.png", size: 1024, fillRatio: 0.62, background: null },
    { name: "android-icon-background.png", size: 1024, fillRatio: 0, background: ICON_BG, flatten: ICON_BG },
    { name: "android-icon-foreground.png", size: 1024, fillRatio: 0.55, strokeWidth: 2.4, background: null },
    { name: "android-icon-monochrome.png", size: 1024, fillRatio: 0.55, strokeWidth: 2.4, background: null },
    { name: "favicon.png", size: 48, fillRatio: 0.82, background: INK, cornerRadius: 9 },
  ];
  for (const item of LEGACY_IMAGES) {
    const out = join(APP_ROOT, "assets/images", item.name);
    if (!existsSync(dirname(out))) continue;
    rasteriseFromString(
      composedSvg({
        size: item.size,
        fillRatio: item.fillRatio,
        strokeWidth: item.strokeWidth ?? MARK_STROKE_WIDTH,
        color: WHITE,
        background: item.background,
        cornerRadius: item.cornerRadius ?? 0,
      }),
      out,
      item.size,
      { flatten: item.flatten ?? null }
    );
    written.push(out);
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
function main() {
  try {
    magick(["-version"]);
  } catch {
    console.error("ImageMagick 7 is required (`magick` not found on PATH).");
    process.exit(1);
  }

  const written = [];
  const siteAvailable = existsSync(SITE_ROOT);

  // 0. Shared path module, so the in-app and website marks cannot drift from
  //    the generated icon files.
  const moduleSource = markModule();
  const moduleTargets = [
    ...MODULE_TARGETS,
    ...(siteAvailable ? [join(SITE_ROOT, "src/lib/brand/mark-path.ts")] : []),
  ];
  for (const target of moduleTargets) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, moduleSource, "utf8");
    written.push(target);
  }

  // 1. SVG sources
  for (const item of SVGS) {
    mkdirSync(dirname(item.path), { recursive: true });
    writeFileSync(item.path, item.contents, "utf8");
    written.push(item.path);
  }

  // 2. App PNGs
  for (const item of PNGS) {
    const svg = composedSvg({
      size: item.size,
      fillRatio: item.fillRatio,
      color: item.color,
      background: item.background,
      cornerRadius: item.cornerRadius ?? 0,
      strokeWidth: item.strokeWidth ?? MARK_STROKE_WIDTH,
    });
    rasteriseFromString(svg, item.path, item.size, { flatten: item.flatten ?? null });
    written.push(item.path);
  }

  // 3. ICO bundle for the Expo web output
  const webDir = join(APP_ROOT, "assets/web");
  mkdirSync(webDir, { recursive: true });
  const icoPath = join(webDir, "favicon.ico");
  magick([
    join(webDir, "favicon-16x16.png"),
    join(webDir, "favicon-32x32.png"),
    join(webDir, "favicon-48x48.png"),
    icoPath,
  ]);
  written.push(icoPath);

  // 3b. Expo web boilerplate that still carried the appicon.online defaults.
  writeFileSync(join(webDir, "head-snippet.html"), HEAD_SNIPPET, "utf8");
  writeFileSync(join(webDir, "site.webmanifest"), WEB_MANIFEST, "utf8");
  written.push(join(webDir, "head-snippet.html"), join(webDir, "site.webmanifest"));

  // 4. Marketing site
  if (siteAvailable) {
    writeFileSync(join(SITE_ROOT, "src/app/icon.svg"), siteIconSvg(), "utf8");
    written.push(join(SITE_ROOT, "src/app/icon.svg"));

    writeFileSync(join(SITE_ROOT, "public/logo-mark.svg"), SVGS[0].contents, "utf8");
    writeFileSync(join(SITE_ROOT, "public/logo-mark-white.svg"), SVGS[1].contents, "utf8");
    writeFileSync(join(SITE_ROOT, "public/logo-tile.svg"), SVGS[2].contents, "utf8");
    written.push(
      join(SITE_ROOT, "public/logo-mark.svg"),
      join(SITE_ROOT, "public/logo-mark-white.svg"),
      join(SITE_ROOT, "public/logo-tile.svg")
    );

    for (const item of SITE_PNGS) {
      const svg = composedSvg({
        size: item.size,
        fillRatio: item.fillRatio,
        color: WHITE,
        background: item.background,
        cornerRadius: item.cornerRadius,
      });
      const out = join(SITE_ROOT, item.dir, item.name);
      rasteriseFromString(svg, out, item.size, { flatten: item.flatten ?? null });
      written.push(out);
    }

    // Site favicon.ico, multi-resolution
    const tmp = join(SITE_ROOT, "src/app/.ico");
    mkdirSync(tmp, { recursive: true });
    for (const size of [16, 32, 48]) {
      const svg = composedSvg({
        size,
        fillRatio: size <= 32 ? 0.92 : 0.88,
        strokeWidth: size <= 16 ? 2.8 : size <= 32 ? 2.4 : MARK_STROKE_WIDTH,
        color: WHITE,
        background: INK,
        cornerRadius: Math.round(size * 0.2),
      });
      rasteriseFromString(svg, join(tmp, `f${size}.png`), size);
    }
    magick([
      join(tmp, "f16.png"),
      join(tmp, "f32.png"),
      join(tmp, "f48.png"),
      join(SITE_ROOT, "src/app/favicon.ico"),
    ]);
    written.push(join(SITE_ROOT, "src/app/favicon.ico"));
    execFileSync("rm", ["-rf", tmp]);

    // Open Graph / Twitter card.
    //
    // These live in public/ with a stable URL rather than using Next's
    // opengraph-image file convention: the convention only covers the segment
    // the file sits in, so content routes under [slug] inherited nothing. A
    // fixed path can be referenced from buildMetadata for every page.
    const font = findFont();
    if (font) {
      buildOgImage(font, join(SITE_ROOT, "public/opengraph-image.png"));
      buildOgImage(font, join(SITE_ROOT, "public/twitter-image.png"));
      written.push(
        join(SITE_ROOT, "public/opengraph-image.png"),
        join(SITE_ROOT, "public/twitter-image.png")
      );

      // Remove the segment-scoped copies so there is one source of the card.
      for (const stale of [
        join(SITE_ROOT, "src/app/opengraph-image.png"),
        join(SITE_ROOT, "src/app/twitter-image.png"),
      ]) {
        if (existsSync(stale)) execFileSync("rm", ["-f", stale]);
      }
    } else {
      console.warn("! No usable font found — skipped the Open Graph image.");
    }

    writeFileSync(join(SITE_ROOT, "public/logo-maskable.svg"), siteMaskableSvg(), "utf8");
    written.push(join(SITE_ROOT, "public/logo-maskable.svg"));
  } else {
    console.warn(`! Marketing site not found at ${SITE_ROOT} — app assets only.`);
  }

  // 5. Exported icon sets left behind by earlier tooling
  regenerateIconExports(written);

  console.log(`Generated ${written.length} brand assets.`);
  for (const path of written) {
    console.log(`  ${path.replace(`${APP_ROOT}/`, "").replace(`${SITE_ROOT}/`, "site:")}`);
  }
}

/**
 * Renders text to a tightly-sized transparent PNG so it can be composited at an
 * exact position.
 *
 * `-annotate` was the obvious tool here and it is the wrong one: its y offset
 * anchors to the text baseline under some gravities and to the bounding box
 * under others, which silently overlapped the wordmark and the tagline. Building
 * each line as its own image and compositing it means every position is a number
 * we chose, and the heights are measured rather than assumed.
 */
function labelImage({ text, font, pointsize, color, out }) {
  magick([
    "-background",
    "none",
    "-font",
    font,
    "-pointsize",
    String(pointsize),
    "-fill",
    color,
    `label:${text}`,
    "-bordercolor",
    "none",
    "-border",
    "0",
    out,
  ]);
  const width = Number(magick(["-format", "%w", out, "info:"]).trim());
  const height = Number(magick(["-format", "%h", out, "info:"]).trim());
  return { width, height };
}

function buildOgImage(font, outPath) {
  const work = `${outPath}.parts`;
  mkdirSync(work, { recursive: true });

  const clean = (name) => join(work, name);

  // Mark tile. The card sits on ink, so this uses the site footer's treatment
  // for dark surfaces — a white tile with the mark in brand brown — rather than
  // the header's ink tile, which would disappear into the background.
  const mark = composedSvg({
    size: 1024,
    fillRatio: 0.62,
    color: BROWN,
    background: WHITE,
    cornerRadius: 230,
  });
  const markPng = clean("mark.png");
  rasteriseFromString(mark, markPng, 190);

  // Text lines
  const word1 = labelImage({
    text: "Chat",
    font,
    pointsize: 82,
    color: WHITE,
    out: clean("w1.png"),
  });
  const word2 = labelImage({
    text: "Cart",
    font,
    pointsize: 82,
    color: BROWN_LIGHT,
    out: clean("w2.png"),
  });
  const tagline = labelImage({
    text: "Chat, agree the price, pay into escrow.",
    font,
    pointsize: 34,
    color: "#e8e4dc",
    out: clean("tag.png"),
  });
  const subline = labelImage({
    text: "Social commerce marketplace for Nigeria",
    font,
    pointsize: 26,
    color: "#8f9a96",
    out: clean("sub.png"),
  });

  // Lay the text block out top-down, then centre the whole block vertically.
  const GAP_WORD_TAG = 26;
  const GAP_TAG_SUB = 16;
  const blockHeight =
    word1.height + GAP_WORD_TAG + tagline.height + GAP_TAG_SUB + subline.height;
  const textX = 340;
  const wordY = Math.round((630 - blockHeight) / 2);
  const tagY = wordY + word1.height + GAP_WORD_TAG;
  const subY = tagY + tagline.height + GAP_TAG_SUB;

  const markY = Math.round((630 - 190) / 2);

  magick([
    "-size",
    "1200x630",
    `xc:${INK}`,
    // Brand accent bar down the left edge
    "-fill",
    BROWN,
    "-draw",
    "rectangle 0,0 14,629",
    markPng,
    "-gravity",
    "northwest",
    "-geometry",
    `+92+${markY}`,
    "-composite",
    clean("w1.png"),
    "-geometry",
    `+${textX}+${wordY}`,
    "-composite",
    clean("w2.png"),
    "-geometry",
    `+${textX + word1.width}+${wordY}`,
    "-composite",
    clean("tag.png"),
    "-geometry",
    `+${textX}+${tagY}`,
    "-composite",
    clean("sub.png"),
    "-geometry",
    `+${textX}+${subY}`,
    "-composite",
    "-strip",
    outPath,
  ]);

  execFileSync("rm", ["-rf", work]);
}

main();
