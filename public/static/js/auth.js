/**
 * Authentication screen: sign in / sign up.
 * Unauthenticated visitors never receive the application shell.
 */
import { api, toastError, toast, esc, withBusy } from './core.js'

let mode = 'signin'

function authMarkup() {
  const isSignup = mode === 'signup'
  return `
    <section class="w-full max-w-md">
      <header class="mb-8 text-center">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-ink-900 text-white shadow-lg">
          <i class="fa-solid fa-bolt"></i>
        </div>
        <h1 class="text-xl font-semibold text-ink-900">PDBOS</h1>
        <p class="mt-1 text-sm text-ink-500">Personal Digital Business OS</p>
      </header>

      <div class="card overflow-hidden">
        <div class="grid grid-cols-2 border-b border-ink-200 bg-ink-50">
          <button type="button" data-mode="signin"
            class="px-4 py-3 text-sm font-medium transition ${!isSignup ? 'bg-white text-ink-900' : 'text-ink-500 hover:text-ink-700'}">
            Sign in
          </button>
          <button type="button" data-mode="signup"
            class="px-4 py-3 text-sm font-medium transition ${isSignup ? 'bg-white text-ink-900' : 'text-ink-500 hover:text-ink-700'}">
            Create account
          </button>
        </div>

        <form id="auth-form" class="space-y-4 p-5" novalidate>
          ${isSignup ? `
            <div>
              <label class="field-label" for="auth-name">Your name</label>
              <input id="auth-name" name="name" type="text" required autocomplete="name"
                class="field-input" placeholder="e.g. Budi Santoso">
            </div>
            <div>
              <label class="field-label" for="auth-business">Business name <span class="font-normal text-ink-400">(optional)</span></label>
              <input id="auth-business" name="business_name" type="text" autocomplete="organization"
                class="field-input" placeholder="e.g. Sparkmind Digital">
            </div>` : ''}

          <div>
            <label class="field-label" for="auth-email">Email</label>
            <input id="auth-email" name="email" type="email" required autocomplete="email"
              class="field-input" placeholder="you@example.com">
          </div>

          <div>
            <label class="field-label" for="auth-password">Password</label>
            <div class="relative">
              <input id="auth-password" name="password" type="password" required
                autocomplete="${isSignup ? 'new-password' : 'current-password'}"
                class="field-input pr-10" placeholder="${isSignup ? 'At least 8 characters' : 'Your password'}">
              <button type="button" data-toggle-password
                class="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-ink-400 hover:text-ink-600"
                aria-label="Show password">
                <i class="fa-regular fa-eye text-xs"></i>
              </button>
            </div>
            ${isSignup ? '<p class="mt-1 text-xs text-ink-400">Must contain at least one letter and one number.</p>' : ''}
          </div>

          ${isSignup ? `
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="field-label" for="auth-currency">Currency</label>
                <select id="auth-currency" name="currency" class="field-select">
                  <option value="IDR" selected>IDR — Rupiah</option>
                  <option value="USD">USD — Dollar</option>
                  <option value="MYR">MYR — Ringgit</option>
                  <option value="SGD">SGD — Singapore Dollar</option>
                </select>
              </div>
              <div>
                <label class="field-label" for="auth-timezone">Timezone</label>
                <select id="auth-timezone" name="timezone" class="field-select">
                  <option value="Asia/Jakarta" selected>Asia/Jakarta</option>
                  <option value="Asia/Makassar">Asia/Makassar</option>
                  <option value="Asia/Jayapura">Asia/Jayapura</option>
                  <option value="Asia/Singapore">Asia/Singapore</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
            </div>` : ''}

          <div id="auth-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>

          <button type="submit" class="btn btn-primary w-full">
            ${isSignup ? 'Create account' : 'Sign in'}
          </button>

          ${isSignup ? `
            <p class="text-center text-xs text-ink-400">
              The first account of a business becomes its <span class="font-semibold text-ink-600">Owner</span>
              with full access.
            </p>` : ''}
        </form>
      </div>

      <p class="mt-6 text-center text-xs text-ink-400">
        Phase 0 · Survival Engine · Data stored in Cloudflare D1
      </p>
    </section>`
}

export function renderAuth(onSuccess) {
  const screen = document.getElementById('auth-screen')
  document.getElementById('app-shell').classList.add('hidden')
  document.getElementById('boot-screen')?.classList.add('hidden')
  screen.classList.remove('hidden')
  screen.classList.add('flex')
  screen.innerHTML = authMarkup()

  screen.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.mode
      if (next === mode) return
      mode = next
      renderAuth(onSuccess)
    })
  })

  const toggle = screen.querySelector('[data-toggle-password]')
  toggle?.addEventListener('click', () => {
    const input = screen.querySelector('#auth-password')
    const show = input.type === 'password'
    input.type = show ? 'text' : 'password'
    toggle.innerHTML = `<i class="fa-regular ${show ? 'fa-eye-slash' : 'fa-eye'} text-xs"></i>`
  })

  const form = screen.querySelector('#auth-form')
  const errorBox = screen.querySelector('#auth-error')

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errorBox.classList.add('hidden')

    const payload = {
      email: form.email.value.trim(),
      password: form.password.value
    }
    if (mode === 'signup') {
      payload.name = form.name.value.trim()
      payload.business_name = form.business_name.value.trim() || undefined
      payload.currency = form.currency.value
      payload.timezone = form.timezone.value
    }

    // Client-side pre-checks mirror the server rules to avoid a round trip.
    if (!payload.email || !payload.password) {
      errorBox.textContent = 'Email and password are required.'
      errorBox.classList.remove('hidden')
      return
    }
    if (mode === 'signup') {
      if (!payload.name) {
        errorBox.textContent = 'Please enter your name.'
        errorBox.classList.remove('hidden')
        return
      }
      if (payload.password.length < 8 || !/[A-Za-z]/.test(payload.password) || !/[0-9]/.test(payload.password)) {
        errorBox.textContent = 'Password must be at least 8 characters and include a letter and a number.'
        errorBox.classList.remove('hidden')
        return
      }
    }

    const restore = withBusy(form.querySelector('button[type=submit]'), 'Please wait…')
    try {
      await api.post(mode === 'signup' ? '/auth/signup' : '/auth/signin', payload)
      toast(mode === 'signup' ? 'Account created. Welcome to PDBOS.' : 'Signed in.', 'success')
      screen.classList.add('hidden')
      screen.classList.remove('flex')
      await onSuccess()
    } catch (err) {
      restore()
      errorBox.textContent = err?.message || 'Could not sign you in.'
      errorBox.classList.remove('hidden')
      if (err?.code === 'NETWORK' || err?.status >= 500) toastError(err)
    }
  })
}

export async function signOut() {
  try {
    await api.post('/auth/signout')
  } catch {
    // Even if the call fails the local session must be dropped.
  }
  window.location.hash = ''
  window.location.reload()
}
