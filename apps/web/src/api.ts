import { useEffect, useRef, useState } from 'react';
export type Data = Record<string, any>;
export interface User {
  user_id: number;
  full_name: string;
  email: string;
  role: 'Buyer' | 'Farmer' | 'Admin';
  location: string | null;
  business_name: string | null;
}
export interface Session {
  user: User | null;
  csrf: string;
}
let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
  });
  const body = await response
    .json()
    .catch(() => ({ message: 'The server returned an unreadable response.' }));
  if (!response.ok)
    throw new Error(typeof body.message === 'string' ? body.message : 'The request failed.');
  return body as T;
}
export const send = <T = any>(
  path: string,
  body?: unknown,
  method = 'POST',
  headers?: Record<string, string>,
) => api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
export function useData<T = any>(path: string | null, poll = false) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1),
    lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current !== path) {
      setData(null);
      lastPath.current = path;
    }
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true,
      running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (active) {
          setData(value);
          setError('');
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load data.');
      } finally {
        running = false;
        if (active) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const timer = poll
      ? setInterval(() => {
          if (!document.hidden) void load();
        }, 30000)
      : undefined;
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [path, poll, version]);
  return { data: lastPath.current === path ? data : null, error, loading, refresh };
}
export const money = (value: unknown) =>
  new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
export const date = (value: string) =>
  new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z').toLocaleString('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
