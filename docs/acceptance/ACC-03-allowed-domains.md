# ACC-03: Only accounts from allowed domains

Only accounts from the company's own domains may log in. The domains are set in `OAUTH_ALLOWED_DOMAINS`, which is `example.com` in `mise.toml`; `mallory@other.example` is the development user outside it.

## AC-1: An account outside the domains is refused

IF an account from a domain that is not allowed logs in, THEN Skjera SHALL refuse it with «This account is not allowed to sign in.», and SHALL not log it in.

**Test**

- **Given** a private window at http://localhost:5173
- **When** you click **Log in** and log in at Dex as `mallory@other.example`, password `password`
- **Then** the page says «This account is not allowed to sign in.»
- **When** you open http://localhost:5173 again
- **Then** the header still shows **Log in**

**Automated:** `packages/oauth/e2e/specs/login.spec.ts`, `packages/oauth/test/OAuthClient.domains.test.ts`, `packages/oauth/test/allowedDomains.test.ts`

## AC-2: An account in the domains logs in

WHEN an account from an allowed domain logs in, Skjera SHALL log it in.

**Test**

- **Given** a private window at http://localhost:5173
- **When** you log in as `bob@example.com`
- **Then** bob is logged in, with his account menu in the header

**Automated:** `packages/oauth/e2e/specs/login.spec.ts`, `packages/oauth/test/OAuthClient.domains.test.ts`, `packages/oauth/test/allowedDomains.test.ts`

## AC-3: No domains set, everyone gets in

WHERE no allowed domains are set, Skjera SHALL let in every account the login provider accepts.

**Test**

- **Given** `OAUTH_ALLOWED_DOMAINS = ""` under `[env]` in `mise.local.toml`, and `pnpm dev` restarted
- **When** you log in as `mallory@other.example`
- **Then** mallory is logged in
- **And** remove the line from `mise.local.toml` and restart `pnpm dev` afterwards

**Automated:** `packages/oauth/test/allowedDomains.test.ts`

## AC-4: Google's account picker shows the company's accounts

WHERE the login provider is Google and allowed domains are set, Skjera SHALL ask Google to offer only accounts of those domains when the user picks an account.

**Automated only:** development logs in with Dex, not Google. `packages/oauth/test/OAuthClient.domains.test.ts`

## AC-5: Google accounts only from the company's Workspace

WHERE the login provider is Google, Skjera SHALL let in only accounts that belong to the company's Google Workspace, and SHALL refuse a personal Google account registered with a company email address.

**Automated only:** development logs in with Dex, not Google. `packages/oauth/test/OAuthClient.domains.test.ts`, `packages/oauth/test/allowedDomains.test.ts`
