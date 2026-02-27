// session.ts — Session management delegating to StorageInterface.
// All methods are async (Phase B ready). Ephemeral mode handled by storage layer.

import { randomUUID } from 'node:crypto';
import type { Session, StorageInterface } from './types.js';

/** Create a new session, return it. */
export async function createSession(
  storage: StorageInterface,
  partial: Omit<Session, 'id' | 'created_at' | 'last_accessed' | 'state' | 'answers'>,
): Promise<Session> {
  const session: Session = {
    ...partial,
    id: randomUUID(),
    state: 'ANALYZING',
    created_at: Date.now(),
    last_accessed: Date.now(),
    answers: {},
  };
  await storage.saveSession(session);
  return session;
}

/** Get a session by ID. Returns undefined if expired or not found. */
export async function getSession(
  storage: StorageInterface,
  id: string,
): Promise<Session | undefined> {
  const session = await storage.loadSession(id);
  if (!session) return undefined;
  session.last_accessed = Date.now();
  await storage.saveSession(session);
  return session;
}

/** Update a session in place. */
export async function updateSession(
  storage: StorageInterface,
  id: string,
  updates: Partial<Session>,
): Promise<Session | undefined> {
  const session = await getSession(storage, id);
  if (!session) return undefined;
  Object.assign(session, updates, { last_accessed: Date.now() });
  await storage.saveSession(session);
  return session;
}
