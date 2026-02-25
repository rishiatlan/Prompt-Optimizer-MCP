// session.ts — In-memory session store with TTL cleanup.

import type { Session } from './types.js';
import { randomUUID } from 'node:crypto';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const sessions = new Map<string, Session>();

/** Create a new session, return its ID. */
export function createSession(partial: Omit<Session, 'id' | 'created_at' | 'last_accessed' | 'state' | 'answers'>): Session {
  cleanup();
  const session: Session = {
    ...partial,
    id: randomUUID(),
    state: 'ANALYZING',
    created_at: Date.now(),
    last_accessed: Date.now(),
    answers: {},
  };
  sessions.set(session.id, session);
  return session;
}

/** Get a session by ID. Returns undefined if expired or not found. */
export function getSession(id: string): Session | undefined {
  cleanup();
  const session = sessions.get(id);
  if (!session) return undefined;
  session.last_accessed = Date.now();
  return session;
}

/** Update a session in place. */
export function updateSession(id: string, updates: Partial<Session>): Session | undefined {
  const session = getSession(id);
  if (!session) return undefined;
  Object.assign(session, updates, { last_accessed: Date.now() });
  return session;
}

/** Remove expired sessions. */
function cleanup(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.last_accessed > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}
