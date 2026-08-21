export interface PendingNavigation {
  path: string;
  proceed: () => void;
}

type NavigationBlocker = (navigation: PendingNavigation) => boolean;

let activeBlocker: NavigationBlocker | null = null;

export function registerNavigationBlocker(blocker: NavigationBlocker): () => void {
  activeBlocker = blocker;
  return () => {
    if (activeBlocker === blocker) activeBlocker = null;
  };
}

export function requestNavigation(path: string, proceed: () => void): boolean {
  return activeBlocker?.({ path, proceed }) === true;
}
