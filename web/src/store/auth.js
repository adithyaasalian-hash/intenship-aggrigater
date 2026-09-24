import { create } from 'zustand';
import { api } from '../api/client.js';

/**
 * Auth is the only genuinely global client state in the app. Everything else
 * -- feed, listings, tracker -- is server state and belongs to React Query,
 * which already handles caching, retries and invalidation.
 */
export const useAuth = create((set) => ({
  user: null,
  status: 'loading', // loading | signedIn | signedOut

  async bootstrap() {
    try {
      const { user } = await api.session();
      set({ user, status: 'signedIn' });
    } catch {
      set({ user: null, status: 'signedOut' });
    }
  },

  async signIn(credentials) {
    const { user } = await api.login(credentials);
    set({ user, status: 'signedIn' });
    return user;
  },

  async signUp(credentials) {
    const { user } = await api.register(credentials);
    set({ user, status: 'signedIn' });
    return user;
  },

  async signOut() {
    await api.logout().catch(() => {});
    set({ user: null, status: 'signedOut' });
  },

  setUser: (user) => set({ user }),
}));
