import { randomBytes, timingSafeEqual } from "node:crypto";

export function createLocalAuth() {
  const token = randomBytes(32).toString("base64url");
  const expected = Buffer.from(token);
  return {
    token,
    accepts(authorization: string | undefined) {
      const match = authorization?.match(/^Bearer ([\w-]{43})$/i);
      if (!match?.[1]) return false;
      const supplied = Buffer.from(match[1]);
      return (
        supplied.length === expected.length &&
        timingSafeEqual(supplied, expected)
      );
    },
  };
}

export type LocalAuth = ReturnType<typeof createLocalAuth>;
