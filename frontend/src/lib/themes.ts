export type ThemeMode = 'light' | 'dark' | 'system'

export interface AccentTheme {
  name: string
  label: string
  preview: string // color swatch for the picker
  cssClass: string
}

export const accentThemes: AccentTheme[] = [
  { name: 'zinc', label: 'Zinc', preview: '#71717a', cssClass: '' },
  { name: 'slate', label: 'Slate', preview: '#64748b', cssClass: 'theme-slate' },
  { name: 'blue', label: 'Blue', preview: '#3b82f6', cssClass: 'theme-blue' },
  { name: 'green', label: 'Green', preview: '#22c55e', cssClass: 'theme-green' },
]

const THEME_MODE_KEY = 'theme-mode'
const THEME_ACCENT_KEY = 'theme-accent'

export function getStoredMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_MODE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function getStoredAccent(): string {
  return localStorage.getItem(THEME_ACCENT_KEY) ?? 'zinc'
}

export function storeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_MODE_KEY, mode)
}

export function storeAccent(accent: string) {
  localStorage.setItem(THEME_ACCENT_KEY, accent)
}

export function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')

  if (mode === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.add(prefersDark ? 'dark' : 'light')
  } else {
    root.classList.add(mode)
  }
}

export function applyAccentTheme(accent: string) {
  const root = document.documentElement
  // Remove all accent classes
  for (const theme of accentThemes) {
    if (theme.cssClass) {
      root.classList.remove(theme.cssClass)
    }
  }
  // Apply new one
  const found = accentThemes.find((t) => t.name === accent)
  if (found?.cssClass) {
    root.classList.add(found.cssClass)
  }
}

export function initTheme() {
  const mode = getStoredMode()
  const accent = getStoredAccent()
  applyThemeMode(mode)
  applyAccentTheme(accent)

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredMode() === 'system') {
      applyThemeMode('system')
    }
  })
}
