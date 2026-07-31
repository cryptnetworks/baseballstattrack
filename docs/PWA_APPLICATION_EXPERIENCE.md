# Progressive web application experience

M7 adds an installable, mobile-first PWA shell while keeping Baseball Stat
Track online-first and server-authoritative. Installation changes how the web
application is launched; it does not create a second scoring database or an
offline command authority.

## Installability

The application publishes `/manifest.webmanifest` with a standalone display
mode, stable root scope, application and short names, theme/background colors,
and branded 192px, 512px, and Apple touch icons. The 512px icon is marked
maskable and keeps its important artwork inside the safe central region.

The browser install prompt is progressive enhancement. Browsers that expose
`beforeinstallprompt` receive an accessible install/not-now prompt. Browsers
without that event remain fully usable and can use their native Add to Home
Screen action. The dismissed-prompt preference is the only M7 browser storage
value.

## Service-worker scope and cache policy

`public/service-worker.js` is registered only in production and owns the root
scope. Its cache is limited to:

- Next.js hashed static assets under `/_next/static/`;
- the manifest; and
- the public application icons.

Navigation requests, API requests, authentication routes, and all other
dynamic responses bypass the cache. The worker never stores HTML, Account
data, player data, scoring events, commands, credentials, cookies, or private
reports. Cache names are versioned and old M7 static caches are deleted on
activation. The worker is an asset delivery optimization, not an application
state authority.

## Online-first and authentication behavior

The connection banner distinguishes online from interrupted connectivity and
states that saved server state remains authoritative. It tells a scorer to
wait for reconnection before saving new scoring actions; it never claims that
scoring can continue offline.

Authentication, session expiration, membership checks, Account authorization,
server validation, idempotency, replay, and corrections remain unchanged. No
authentication token or private page is placed in browser storage or a service
worker cache. Existing M2 recovery behavior remains the supported way to
resume an interrupted session.

## Mobile shell and accessibility

The application shell now provides a branded home link, an explicit
online-first label, horizontally scrollable touch-sized navigation on narrow
screens, and `aria-current` for the active workflow. Existing skip links,
focus indicators, safe-area padding, reduced-motion behavior, semantic status
regions, and server-rendered route loading states remain in force.

The install prompt and connection status use named regions, live announcements,
keyboard-native buttons, visible focus, and text that does not rely on color
alone. The shell supports phone portrait, phone landscape, tablet, and desktop
layouts without changing scoring controls or event semantics.

## Notifications

M7 creates no push-notification platform and requests no notification
permission. A future notification integration must define consent,
categories, unsubscribe behavior, and privacy minimization before activation.

## Performance and limitations

The service worker avoids HTML and data caching, so authenticated routes still
perform their normal server requests. Hashed static asset caching reduces
repeat startup cost without allowing stale authorization or scoring state.
The existing production bundle, route-isolation, responsive, and interaction
budgets remain the performance gates; M7 adds manifest, icon, and worker
boundary checks.

## Explicit offline deferral

This milestone does not implement offline scoring, local event acceptance,
background sync, conflict resolution, offline authentication, local replicated
databases, or device-to-device merging. Issue #34 and the existing offline
strategy documents remain decision/design references for a future milestone.
M7 uses only the already-shipped same-device recovery and visible retry
behavior; it does not reinterpret that recovery as offline synchronization.
