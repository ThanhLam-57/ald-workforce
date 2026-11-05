import { createHash, timingSafeEqual } from "node:crypto";

const AUTHORIZATION_HEADER_MAX_LENGTH = 512;
const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 256;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RevenueLeaderboardConfig = Readonly<{
  companyId: string;
  tokenSha256: string;
}>;

type RevenueLeaderboardEnvironment = Readonly<Record<string, string | undefined>>;

export function hashRevenueLeaderboardToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readRevenueLeaderboardConfig(
  environment: RevenueLeaderboardEnvironment = process.env,
): RevenueLeaderboardConfig | null {
  if (environment.REVENUE_LEADERBOARD_ENABLED !== "true") return null;

  const companyId = environment.REVENUE_LEADERBOARD_COMPANY_ID;
  const tokenSha256 = environment.REVENUE_LEADERBOARD_TOKEN_SHA256;
  if (!companyId || !UUID_PATTERN.test(companyId) || !tokenSha256) return null;
  if (!SHA256_HEX_PATTERN.test(tokenSha256)) return null;

  return {
    companyId,
    tokenSha256: tokenSha256.toLowerCase(),
  };
}

export function isRevenueLeaderboardAuthorized(
  authorization: string | null,
  expectedTokenSha256: string,
): boolean {
  const expectedHashIsValid = SHA256_HEX_PATTERN.test(expectedTokenSha256);
  const expectedDigest = Buffer.from(
    expectedHashIsValid ? expectedTokenSha256 : "0".repeat(64),
    "hex",
  );

  const headerWithinBounds =
    authorization !== null && authorization.length <= AUTHORIZATION_HEADER_MAX_LENGTH;
  const match = headerWithinBounds ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
  const token = match?.[1] ?? "";
  const tokenIsValid = token.length >= TOKEN_MIN_LENGTH && token.length <= TOKEN_MAX_LENGTH;
  const presentedDigest = Buffer.from(
    hashRevenueLeaderboardToken(tokenIsValid ? token : ""),
    "hex",
  );
  const digestsMatch = timingSafeEqual(presentedDigest, expectedDigest);

  return expectedHashIsValid && tokenIsValid && digestsMatch;
}
