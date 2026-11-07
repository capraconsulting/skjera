const segment = (value: string) => encodeURIComponent(value);

const withQuery = (
  path: string,
  values: Readonly<Record<string, string | undefined>>,
) => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) search.set(name, value);
  }
  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
};

export const appQuery = {
  guest: "guest",
  token: "token",
  version: "version",
  kind: "kind",
  returnTo: "returnTo",
  tag: "tag",
} as const;

export const appPatterns = {
  root: "/",
  event: "/events/:id",
  cancelEvent: "/events/:id/cancel",
  preview: "/events/:id/preview",
  account: "/account",
  privacy: "/privacy",
  loginFailed: "/login-failed",
  studio: "/studio",
  studioTeams: "/studio/teams",
  studioTeam: "/studio/teams/:teamId",
  studioEvent: "/studio/teams/:teamId/events/:id",
} as const;

export const appRouteChildren = {
  studioTeams: "teams",
  studioTeam: ":teamId",
  studioEvent: "events/:id",
} as const;

export const appPaths = {
  root: appPatterns.root,
  account: appPatterns.account,
  privacy: appPatterns.privacy,
  login: "/auth/login",
  logout: "/auth/logout",
  loginFailed: appPatterns.loginFailed,
  subscribe: "/api/subscribe",
  studio: appPatterns.studio,
  studioTeams: appPatterns.studioTeams,
  event: (id: string) => `/events/${segment(id)}`,
  guestEvent: (id: string, guest: string, token: string) =>
    withQuery(`/events/${segment(id)}`, {
      [appQuery.guest]: guest,
      [appQuery.token]: token,
    }),
  cancelEvent: (id: string, token: string) =>
    withQuery(appPatterns.cancelEvent.replace(":id", segment(id)), {
      [appQuery.token]: token,
    }),
  preview: (id: string, version?: string) =>
    withQuery(`/events/${segment(id)}/preview`, {
      [appQuery.version]: version,
    }),
  studioTeam: (teamId: string) => `/studio/teams/${segment(teamId)}`,
  studioEvent: (teamId: string, id: string) =>
    `/studio/teams/${segment(teamId)}/events/${segment(id)}`,
  loginUrl: (returnTo: string) =>
    withQuery("/auth/login", { [appQuery.returnTo]: returnTo }),
  loginFailure: (kind: string, returnTo: string) =>
    withQuery(appPatterns.loginFailed, {
      [appQuery.kind]: kind,
      [appQuery.returnTo]: returnTo,
    }),
  tagFilter: (tag: string) =>
    withQuery(appPatterns.root, { [appQuery.tag]: tag }),
  googleCalendarSubscription: (host: string) =>
    `https://www.google.com/calendar/render?${new URLSearchParams({ cid: `webcal://${host}${appPaths.subscribe}` })}`,
} as const;

export const absoluteAppUrl = (site: string | URL, path: string) =>
  new URL(path, site).href;

export const callbackPath = (redirectUri: string | URL) =>
  new URL(redirectUri).pathname;

export const appSearch = {
  guestEvent: (url: string | URL) => {
    const search = new URL(url).searchParams;
    return {
      guest: search.get(appQuery.guest),
      token: search.get(appQuery.token),
    };
  },
  token: (url: string | URL) => new URL(url).searchParams.get(appQuery.token),
  version: (url: string | URL) =>
    new URL(url).searchParams.get(appQuery.version),
} as const;
