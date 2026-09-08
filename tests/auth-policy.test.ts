import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_LINKING_POLICY,
  canUnlinkAccount,
  getAuthCallbackURL,
  getOAuthProviderConfigs,
  getOAuthProviderStatuses,
  isOAuthProviderId,
} from '../src/auth';

describe('OAuth provider policy', () => {
  it('registers only complete credential pairs', () => {
    const configs = getOAuthProviderConfigs({
      GITHUB_CLIENT_ID: 'github-id',
      GITHUB_CLIENT_SECRET: 'github-secret',
      GOOGLE_CLIENT_ID: 'google-id-only',
      LINUXDO_CLIENT_ID: 'linuxdo-id',
      LINUXDO_CLIENT_SECRET: 'linuxdo-secret',
    });

    expect(configs.map((config) => config.providerId)).toEqual(['github', 'linuxdo']);
    expect(configs[1]).toMatchObject({
      discoveryUrl: 'https://connect.linux.do/.well-known/openid-configuration',
      scopes: ['openid', 'profile', 'email'],
    });
  });

  it('reports missing credentials as unconfigured', () => {
    expect(getOAuthProviderStatuses({})).toEqual([
      { id: 'github', name: 'GitHub', configured: false },
      { id: 'google', name: 'Google', configured: false },
      { id: 'linuxdo', name: 'Linux DO', configured: false },
    ]);
  });

  it('requires explicit account linking and retains one account', () => {
    expect(ACCOUNT_LINKING_POLICY).toMatchObject({
      disableImplicitLinking: true,
      allowDifferentEmails: true,
      allowUnlinkingAll: false,
    });
    expect(canUnlinkAccount(1)).toBe(false);
    expect(canUnlinkAccount(2)).toBe(true);
  });

  it('validates provider IDs and creates stable callback URLs', () => {
    expect(isOAuthProviderId('linuxdo')).toBe(true);
    expect(isOAuthProviderId('unknown')).toBe(false);
    expect(getAuthCallbackURL('github')).toBe('/api/auth/callback/github');
    expect(getAuthCallbackURL('google', 'https://example.com')).toBe(
      'https://example.com/api/auth/callback/google',
    );
  });
});
