import { randomBytes } from 'node:crypto';
import { betterAuth, type Session, type User } from 'better-auth';
import { genericOAuth, type GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';

import { database } from './server/database';

export const AUTH_BASE_PATH = '/api/auth';
export const AUTH_PROVIDER_IDS = ['github', 'google', 'linuxdo'] as const;
export type OAuthProviderId = (typeof AUTH_PROVIDER_IDS)[number];

export interface AuthEnvironment {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  LINUXDO_CLIENT_ID?: string;
  LINUXDO_CLIENT_SECRET?: string;
}

export type OAuthProviderConfig =
  | {
      providerId: 'github';
      name: 'GitHub';
      clientId: string;
      clientSecret: string;
    }
  | {
      providerId: 'google';
      name: 'Google';
      clientId: string;
      clientSecret: string;
    }
  | {
      providerId: 'linuxdo';
      name: 'Linux DO';
      clientId: string;
      clientSecret: string;
      discoveryUrl: string;
      scopes: string[];
    };

export interface OAuthProviderStatus {
  id: OAuthProviderId;
  name: string;
  configured: boolean;
}

export const OAUTH_PROVIDER_LABELS: Readonly<Record<OAuthProviderId, string>> = {
  github: 'GitHub',
  google: 'Google',
  linuxdo: 'Linux DO',
};

export const ACCOUNT_LINKING_POLICY = {
  enabled: true,
  disableImplicitLinking: true,
  allowDifferentEmails: true,
  allowUnlinkingAll: false,
} as const;
const configuredAuthSecret = envValue(process.env.BETTER_AUTH_SECRET);
const configuredAuthBaseURL = envValue(process.env.BETTER_AUTH_URL);
export const AUTH_CORE_CONFIGURED = Boolean(configuredAuthSecret && configuredAuthBaseURL);
// Better Auth validates these options while Astro prerenders public pages.
// Ephemeral/private fallbacks allow the build, while the API and middleware
// remain disabled until both real deployment values are present.
const authSecret = configuredAuthSecret ?? randomBytes(32).toString('hex');
const authBaseURL = configuredAuthBaseURL ?? 'http://127.0.0.1';


function envValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function configuredProvider<Id extends OAuthProviderId>(
  configs: readonly OAuthProviderConfig[],
  providerId: Id,
): Extract<OAuthProviderConfig, { providerId: Id }> | undefined {
  return configs.find(
    (config): config is Extract<OAuthProviderConfig, { providerId: Id }> => config.providerId === providerId,
  );
}

/**
 * Build only providers with a complete credential pair. This keeps an absent
 * OAuth provider out of Better Auth instead of registering a provider that
 * fails later during a login attempt.
 */
export function getOAuthProviderConfigs(env: AuthEnvironment = process.env): OAuthProviderConfig[] {
  const configs: OAuthProviderConfig[] = [];
  const githubClientId = envValue(env.GITHUB_CLIENT_ID);
  const githubClientSecret = envValue(env.GITHUB_CLIENT_SECRET);
  if (githubClientId && githubClientSecret) {
    configs.push({
      providerId: 'github',
      name: 'GitHub',
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    });
  }

  const googleClientId = envValue(env.GOOGLE_CLIENT_ID);
  const googleClientSecret = envValue(env.GOOGLE_CLIENT_SECRET);
  if (googleClientId && googleClientSecret) {
    configs.push({
      providerId: 'google',
      name: 'Google',
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    });
  }

  const linuxdoClientId = envValue(env.LINUXDO_CLIENT_ID);
  const linuxdoClientSecret = envValue(env.LINUXDO_CLIENT_SECRET);
  if (linuxdoClientId && linuxdoClientSecret) {
    configs.push({
      providerId: 'linuxdo',
      name: 'Linux DO',
      clientId: linuxdoClientId,
      clientSecret: linuxdoClientSecret,
      discoveryUrl: 'https://connect.linux.do/.well-known/openid-configuration',
      scopes: ['openid', 'profile', 'email'],
    });
  }

  return configs;
}

export function getConfiguredProviderIds(env: AuthEnvironment = process.env): OAuthProviderId[] {
  return getOAuthProviderConfigs(env).map((config) => config.providerId);
}

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return (AUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export function getOAuthProviderStatuses(env: AuthEnvironment = process.env): OAuthProviderStatus[] {
  const configured = new Set(getConfiguredProviderIds(env));
  return AUTH_PROVIDER_IDS.map((id) => ({
    id,
    name: OAUTH_PROVIDER_LABELS[id],
    configured: configured.has(id),
  }));
}

/** Return the callback path or an absolute callback URL for provider setup. */
export function getAuthCallbackURL(providerId: OAuthProviderId, baseURL?: string): string {
  const callbackPath = `${AUTH_BASE_PATH}/callback/${providerId}`;
  const normalizedBaseURL = envValue(baseURL);
  if (!normalizedBaseURL) return callbackPath;
  try {
    return new URL(callbackPath, normalizedBaseURL).toString();
  } catch {
    return callbackPath;
  }
}

export function canUnlinkAccount(accountCount: number): boolean {
  return Number.isInteger(accountCount) && accountCount > 1;
}

const providerConfigs = getOAuthProviderConfigs();
const githubConfig = configuredProvider(providerConfigs, 'github');
const googleConfig = configuredProvider(providerConfigs, 'google');
const linuxdoConfig = configuredProvider(providerConfigs, 'linuxdo');

const socialProviders = {
  ...(githubConfig
    ? {
        github: {
          clientId: githubConfig.clientId,
          clientSecret: githubConfig.clientSecret,
        },
      }
    : {}),
  ...(googleConfig
    ? {
        google: {
          clientId: googleConfig.clientId,
          clientSecret: googleConfig.clientSecret,
        },
      }
    : {}),
};

const genericOAuthConfigs: GenericOAuthConfig<'linuxdo'>[] = linuxdoConfig ? [linuxdoConfig] : [];

export const auth = betterAuth({
  database,
  baseURL: authBaseURL,
  secret: authSecret,
  socialProviders,
  account: {
    accountLinking: ACCOUNT_LINKING_POLICY,
  },
  plugins: genericOAuthConfigs.length > 0 ? [genericOAuth({ config: genericOAuthConfigs })] : [],
});

export type AuthSession = Session;
export type AuthUser = User;

export default auth;
