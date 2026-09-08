/// <reference types="astro/client" />

import type { AuthSession, AuthUser } from './auth';

declare global {
  namespace App {
    interface Locals {
      user: AuthUser | null;
      session: AuthSession | null;
    }
  }

  namespace NodeJS {
    interface ProcessEnv {
      BLOG_DATABASE_PATH?: string;
      BETTER_AUTH_SECRET?: string;
      BETTER_AUTH_URL?: string;
      GITHUB_CLIENT_ID?: string;
      GITHUB_CLIENT_SECRET?: string;
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      LINUXDO_CLIENT_ID?: string;
      LINUXDO_CLIENT_SECRET?: string;
    }
  }
}

export {};
