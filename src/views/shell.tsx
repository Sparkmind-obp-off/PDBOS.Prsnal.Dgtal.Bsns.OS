/**
 * Application shell.
 *
 * Returns the single HTML document that boots the client. It contains no
 * business data — every number, list and label is fetched from the API after
 * the session is resolved, so there is nothing hardcoded to go stale.
 */
export function appShell(): string {
  return `<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0f172a">
  <meta name="description" content="PDBOS — Personal Digital Business OS. Turn resources into leads, clients, projects and revenue.">
  <title>PDBOS — Personal Digital Business OS</title>

  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            ink: {
              50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
              400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
              800: '#1e293b', 900: '#0f172a', 950: '#020617'
            },
            brand: {
              50: '#eef4ff', 100: '#d9e5ff', 200: '#bcd2ff', 300: '#8eb4ff',
              400: '#598bff', 500: '#3364ff', 600: '#1f42f5', 700: '#1a32e1',
              800: '#1c2cb6', 900: '#1d2c8f'
            }
          },
          fontFamily: {
            sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
            mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
          }
        }
      }
    }
  </script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/static/css/app.css" rel="stylesheet">
</head>
<body class="h-full bg-ink-50 text-ink-800 antialiased">

  <!-- Boot screen: replaced as soon as the session resolves -->
  <div id="boot-screen" class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-ink-50">
    <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-900 text-white shadow-lg">
      <i class="fa-solid fa-bolt text-lg"></i>
    </div>
    <div class="text-sm font-medium text-ink-500">Starting PDBOS…</div>
    <div class="h-1 w-32 overflow-hidden rounded-full bg-ink-200">
      <div class="h-full w-1/3 animate-[loading_1.2s_ease-in-out_infinite] rounded-full bg-ink-900"></div>
    </div>
  </div>

  <!-- Authentication screen -->
  <main id="auth-screen" class="hidden min-h-full items-center justify-center px-4 py-10 sm:px-6"></main>

  <!-- Application shell -->
  <div id="app-shell" class="hidden min-h-full lg:grid lg:grid-cols-[16rem_1fr]">

    <!-- Desktop sidebar -->
    <aside id="sidebar" class="hidden border-r border-ink-200 bg-white lg:flex lg:h-screen lg:flex-col lg:sticky lg:top-0">
      <header class="flex items-center gap-3 border-b border-ink-200 px-5 py-4">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-900 text-white">
          <i class="fa-solid fa-bolt text-sm"></i>
        </div>
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-ink-900">PDBOS</div>
          <div id="sidebar-org" class="truncate text-xs text-ink-500">Loading…</div>
        </div>
      </header>

      <nav id="sidebar-nav" class="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation"></nav>

      <footer class="border-t border-ink-200 p-3">
        <button id="sidebar-user" type="button"
          class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-ink-100">
          <div id="sidebar-avatar"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">?</div>
          <div class="min-w-0 flex-1">
            <div id="sidebar-user-name" class="truncate text-sm font-medium text-ink-900">…</div>
            <div id="sidebar-user-role" class="truncate text-xs text-ink-500">…</div>
          </div>
          <i class="fa-solid fa-gear text-xs text-ink-400"></i>
        </button>
      </footer>
    </aside>

    <!-- Main column -->
    <div class="flex min-h-screen flex-col">

      <!-- Top bar -->
      <header class="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div class="flex items-center gap-2 px-4 py-3 sm:px-6">
          <button id="mobile-menu-btn" type="button"
            class="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 lg:hidden"
            aria-label="Open menu">
            <i class="fa-solid fa-bars"></i>
          </button>

          <div class="min-w-0 flex-1">
            <h1 id="page-title" class="truncate text-base font-semibold text-ink-900 sm:text-lg">Command Center</h1>
            <p id="page-subtitle" class="hidden truncate text-xs text-ink-500 sm:block"></p>
          </div>

          <!-- Global search -->
          <div class="relative hidden sm:block">
            <label for="global-search" class="sr-only">Search</label>
            <i class="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-400"></i>
            <input id="global-search" type="search" autocomplete="off" placeholder="Search everything…"
              class="w-44 rounded-lg border border-ink-200 bg-ink-50 py-2 pl-9 pr-3 text-sm outline-none transition focus:w-64 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100">
            <div id="search-results"
              class="absolute right-0 top-full z-40 mt-2 hidden max-h-96 w-80 overflow-y-auto rounded-xl border border-ink-200 bg-white shadow-xl"></div>
          </div>

          <button id="mobile-search-btn" type="button"
            class="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 sm:hidden"
            aria-label="Search">
            <i class="fa-solid fa-magnifying-glass"></i>
          </button>

          <!-- Notifications -->
          <button id="notif-btn" type="button"
            class="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100"
            aria-label="Notifications">
            <i class="fa-regular fa-bell"></i>
            <span id="notif-badge"
              class="absolute -right-0.5 -top-0.5 hidden min-w-[1.1rem] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">0</span>
          </button>

          <!-- Quick add -->
          <div class="relative">
            <button id="quick-add-btn" type="button"
              class="flex h-9 items-center gap-2 rounded-lg bg-ink-900 px-3 text-sm font-medium text-white transition hover:bg-ink-800"
              aria-label="Quick actions">
              <i class="fa-solid fa-plus text-xs"></i>
              <span class="hidden sm:inline">New</span>
            </button>
            <div id="quick-add-menu"
              class="absolute right-0 top-full z-40 mt-2 hidden w-56 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-xl"></div>
          </div>
        </div>

        <!-- Mobile search row -->
        <div id="mobile-search-row" class="hidden border-t border-ink-200 px-4 py-2 sm:hidden">
          <div class="relative">
            <i class="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-400"></i>
            <input id="global-search-mobile" type="search" autocomplete="off" placeholder="Search everything…"
              class="w-full rounded-lg border border-ink-200 bg-ink-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:bg-white">
          </div>
          <div id="search-results-mobile" class="mt-2 hidden max-h-80 overflow-y-auto rounded-xl border border-ink-200 bg-white"></div>
        </div>
      </header>

      <!-- View outlet -->
      <main id="view-outlet" class="flex-1 px-4 pb-28 pt-4 sm:px-6 sm:pb-10 sm:pt-6"></main>
    </div>

    <!-- Mobile bottom navigation -->
    <nav id="bottom-nav"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      aria-label="Primary navigation"></nav>

    <!-- Mobile drawer -->
    <div id="mobile-drawer" class="fixed inset-0 z-40 hidden lg:hidden">
      <div id="drawer-backdrop" class="absolute inset-0 bg-ink-900/50"></div>
      <aside class="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-2xl">
        <header class="flex items-center justify-between border-b border-ink-200 px-4 py-4">
          <div class="flex items-center gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-900 text-white">
              <i class="fa-solid fa-bolt text-sm"></i>
            </div>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-ink-900">PDBOS</div>
              <div id="drawer-org" class="truncate text-xs text-ink-500"></div>
            </div>
          </div>
          <button id="drawer-close" type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100" aria-label="Close menu">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </header>
        <nav id="drawer-nav" class="flex-1 overflow-y-auto px-3 py-4"></nav>
      </aside>
    </div>
  </div>

  <!-- Notification panel -->
  <div id="notif-panel" class="fixed inset-0 z-40 hidden">
    <div id="notif-backdrop" class="absolute inset-0 bg-ink-900/40"></div>
    <section class="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white shadow-2xl">
      <header class="flex items-center justify-between border-b border-ink-200 px-4 py-4">
        <h2 class="text-sm font-semibold text-ink-900">Notifications</h2>
        <div class="flex items-center gap-1">
          <button id="notif-read-all" type="button"
            class="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">Mark all read</button>
          <button id="notif-close" type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100" aria-label="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </header>
      <div id="notif-list" class="flex-1 overflow-y-auto"></div>
    </section>
  </div>

  <!-- Modal host -->
  <div id="modal-host" class="fixed inset-0 z-50 hidden">
    <div id="modal-backdrop" class="absolute inset-0 bg-ink-900/50"></div>
    <div class="absolute inset-0 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
      <div id="modal-panel"
        class="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" role="dialog" aria-modal="true"></div>
    </div>
  </div>

  <!-- Toast host -->
  <div id="toast-host" class="pointer-events-none fixed bottom-24 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:bottom-6"></div>

  <script type="module" src="/static/js/app.js"></script>
</body>
</html>`
}
