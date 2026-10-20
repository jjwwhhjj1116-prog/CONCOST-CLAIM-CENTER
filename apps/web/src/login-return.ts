export function resolveLoginReturnTo(location: string, isSafePath: (path: string) => boolean): string {
  if (!location.startsWith('/') || location.startsWith('//') || /[\\\u0000-\u0020]/u.test(location)) return '/dashboard';
  const current = new URL(location, 'https://claim-studio.invalid');
  const requested = current.searchParams.get('returnTo') ?? `${current.pathname}${current.search}`;
  const path = requested.split(/[?#]/u)[0];
  return requested.startsWith('/') && !requested.startsWith('//') && !/[\\\u0000-\u0020]/u.test(requested)
    && path !== '/login' && isSafePath(path) ? requested : '/dashboard';
}
