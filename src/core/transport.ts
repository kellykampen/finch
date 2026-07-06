import { Client, OAuth1, ApiError } from "@xdevplatform/xdk";
import type { FinchAuthConfig } from "./config";
import { FinchError } from "./errors";

export interface FinchUser {
  id: string;
  username: string;
  name: string;
}

/**
 * Every core command function depends on this interface, never on the SDK
 * directly — ByokTransport is v1's only implementation; a phase-2
 * ProxyTransport slots in here without touching command handlers.
 */
export interface XTransport {
  getMe(): Promise<FinchUser>;
}

interface GetMeResult {
  data?: { id: string; username: string; name: string };
  errors?: unknown;
}

interface UsersClientLike {
  getMe(): Promise<GetMeResult>;
}

export class ByokTransport implements XTransport {
  constructor(private readonly usersClient: UsersClientLike) {}

  async getMe(): Promise<FinchUser> {
    try {
      const res = await this.usersClient.getMe();
      if (!res.data) {
        throw new FinchError(
          "AUTH_ERROR",
          "X API returned no user data for the provided credentials",
          res.errors ?? null,
        );
      }
      return { id: res.data.id, username: res.data.username, name: res.data.name };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }
}

function mapSdkError(err: unknown): FinchError {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return new FinchError("AUTH_ERROR", "X rejected the provided credentials", err.data ?? null);
    }
    if (err.status === 429) {
      return new FinchError("RATE_LIMITED", "Rate limited by the X API", err.data ?? null);
    }
    return new FinchError("CLIENT_ERROR", err.message, err.data ?? null);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new FinchError("NETWORK_ERROR", message, null);
}

/**
 * Constructs the real SDK-backed transport. `OAuth1Config.apiSecret` is the
 * SDK's name for Finch's own `auth.apiKeySecret` field — mapped here, not
 * renamed in Finch's config schema (which matches the X Developer Portal's
 * own field label).
 */
export function createByokTransport(auth: FinchAuthConfig): XTransport {
  const oauth1 = new OAuth1({
    apiKey: auth.apiKey,
    apiSecret: auth.apiKeySecret,
    accessToken: auth.accessToken,
    accessTokenSecret: auth.accessTokenSecret,
    // Only the redirect-based request-token flow uses this; OAuth1 in v1 is
    // constructed straight from already-issued user-context tokens.
    callback: "oob",
  });
  const client = new Client({ oauth1 });
  return new ByokTransport(client.users);
}
