import { DEFAULT_DISCORD_COLOR } from "../config/constants.js";

/**
 * Safely convert hex color to Discord integer
 * @param hexColor - Hex color string (e.g., "#5865f2" or "5865f2")
 * @returns Discord color integer
 */
export function hexToDiscordColor(hexColor: string): number {
  try {
    // Remove # if present and ensure it's valid
    const cleanHex = hexColor.replace("#", "").trim();

    // Validate hex format (6 characters)
    if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
      console.warn(
        `Invalid hex color: ${hexColor}, using default Discord blurple`,
      );
      return DEFAULT_DISCORD_COLOR;
    }

    const colorInt = parseInt(cleanHex, 16);
    console.log(`Converting color ${hexColor} to Discord integer: ${colorInt}`);
    return colorInt;
  } catch (error) {
    console.warn(`Error parsing color ${hexColor}:`, error);
    return DEFAULT_DISCORD_COLOR;
  }
}
