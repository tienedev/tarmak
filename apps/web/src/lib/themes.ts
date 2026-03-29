export type ThemeMode = 'light' | 'dark' | 'system'

export interface AccentTheme {
  name: string
  label: string
  preview: string
  cssClass: string
}

export const accentThemes: AccentTheme[] = [
  { name: 'amethyst', label: 'Amethyst', preview: '#7c3aed', cssClass: '' },
  { name: 'ocean', label: 'Ocean', preview: '#0891b2', cssClass: 'theme-ocean' },
  { name: 'rose', label: 'Rose', preview: '#e11d48', cssClass: 'theme-rose' },
  { name: 'sage', label: 'Sage', preview: '#059669', cssClass: 'theme-sage' },
]

const THEME_MODE_KEY = 'theme-mode'
const THEME_ACCENT_KEY = 'theme-accent'

export function getStoredMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_MODE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function getStoredAccent(): string {
  const stored = localStorage.getItem(THEME_ACCENT_KEY)
  // Migrate old theme names
  if (stored === 'zinc' || stored === 'slate' || stored === 'blue' || stored === 'green') {
    const migrated = stored === 'blue' ? 'ocean' : stored === 'green' ? 'sage' : 'amethyst'
    localStorage.setItem(THEME_ACCENT_KEY, migrated)
    return migrated
  }
  return stored ?? 'amethyst'
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
  for (const theme of accentThemes) {
    if (theme.cssClass) {
      root.classList.remove(theme.cssClass)
    }
  }
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

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredMode() === 'system') {
      applyThemeMode('system')
    }
  })
}
