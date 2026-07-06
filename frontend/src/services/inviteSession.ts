export interface InviteSession {
  token: string;
  projectId: string;
  email: string;
  appRole: 'editor' | 'reviewer' | 'viewer';
  name?: string;
  expiresAt?: number;
}

const INVITE_SESSION_KEY = 'sdlc:invite-session';

export function getInviteSession(): InviteSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(INVITE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InviteSession;
    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(INVITE_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setInviteSession(session: InviteSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(INVITE_SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore storage failures
  }
}

export function clearInviteSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(INVITE_SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}
