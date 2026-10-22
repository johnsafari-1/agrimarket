import { createContext, useContext, useState, type FormEvent } from 'react';
import type { User, Session } from './api';
export const AuthContext = createContext<{ user: User | null; update: (s: Session) => void }>({
  user: null,
  update: () => {},
});
export const NoticeContext = createContext<(message: string) => void>(() => {});
export const useAuth = () => useContext(AuthContext);
export const values = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
export function useAction() {
  const [busy, setBusy] = useState(false),
    notify = useContext(NoticeContext);
  return {
    busy,
    run: async (work: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await work();
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        setBusy(false);
      }
    },
  };
}
