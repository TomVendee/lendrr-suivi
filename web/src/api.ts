import { useQuery } from "@tanstack/react-query";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (r.status === 401) throw new Error("unauthorized");
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), retry: false });
}
