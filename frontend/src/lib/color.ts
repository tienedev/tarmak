/**
 * Returns true if a hex color is "light" (should use dark text on top).
 * Uses relative luminance approximation from sRGB.
 */
export function isLightColor(hex: string): boolean {
  let c = hex.replace('#', '')
  // Expand 3-digit hex (#abc → aabbcc)
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
  }
  if (c.length !== 6) return false
  const r = parseInt(c.substring(0, 2), 16) / 255
  const g = parseInt(c.substring(2, 4), 16) / 255
  const b = parseInt(c.substring(4, 6), 16) / 255
  // Perceived brightness (ITU-R BT.709)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55
}
