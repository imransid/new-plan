import { randomBytes } from "crypto";

// Base62 without ambiguous glyphs (0/O, 1/I/l). 12 chars ≈ 71 bits of entropy —
// far beyond brute-force range for a join code.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generateJoinCode(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** Normalize a user-entered code (trim, and our alphabet is case-sensitive so keep case). */
export function normalizeJoinCode(input: string): string {
  return input.trim();
}
