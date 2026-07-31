import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

const manifest = read("src/app/manifest.ts");
const layout = read("src/app/layout.tsx");
const serviceWorker = read("public/service-worker.js");
const pwaExperience = read("src/components/pwa/pwa-experience.tsx");

for (const required of [
  'const applicationName = "Baseball Stat Track"',
  "name: applicationName",
  'short_name: "Stat Track"',
  'start_url: "/"',
  'scope: "/"',
  'display: "standalone"',
  'background_color: "#f7f7f4"',
  'theme_color: "#176b4d"',
  '"/icons/icon-192.png"',
  '"/icons/icon-512.png"',
]) {
  if (!manifest.includes(required)) {
    throw new Error(`Manifest is missing ${required}`);
  }
}

for (const required of [
  'manifest: "/manifest.webmanifest"',
  '"/icons/icon.svg"',
  '"/icons/icon-192.png"',
  '"/icons/icon-512.png"',
  '"/icons/apple-touch-icon.png"',
]) {
  if (!layout.includes(required)) {
    throw new Error(`Application metadata is missing ${required}`);
  }
}

for (const required of [
  'request.mode === "navigate"',
  'url.pathname.startsWith("/api/")',
  'url.pathname.startsWith("/auth/")',
  'url.pathname.startsWith("/_next/static/")',
  "self.clients.claim()",
]) {
  if (!serviceWorker.includes(required)) {
    throw new Error(`Service worker boundary is missing ${required}`);
  }
}

for (const forbidden of [
  "indexedDB",
  "background sync",
  "Background Sync",
  "localStorage",
]) {
  if (serviceWorker.includes(forbidden)) {
    throw new Error(`Service worker must not use ${forbidden}`);
  }
}

if (
  !pwaExperience.includes("serviceWorker") ||
  !pwaExperience.includes(".register(")
) {
  throw new Error("The application does not register its service worker");
}
if (!pwaExperience.includes("beforeinstallprompt")) {
  throw new Error("The application does not expose the install flow");
}
if (!pwaExperience.includes("localStorage")) {
  throw new Error(
    "The install dismissal preference is not bounded to browser UI state",
  );
}
if (pwaExperience.match(/localStorage\./g)?.length !== 2) {
  throw new Error(
    "PWA browser storage must remain limited to the dismissible install prompt",
  );
}

function pngDimensions(relativePath) {
  const bytes = readFileSync(join(root, relativePath));
  if (bytes.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${relativePath} is not a PNG`);
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

for (const [relativePath, expected] of [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["public/icons/apple-touch-icon.png", 180],
]) {
  const [width, height] = pngDimensions(relativePath);
  if (width !== expected || height !== expected) {
    throw new Error(`${relativePath} must be ${expected}x${expected}`);
  }
}

console.log(
  "PWA manifest, icons, service-worker boundary, and storage policy passed.",
);
