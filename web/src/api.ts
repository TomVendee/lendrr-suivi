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

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Assignment {
  user_id: string;
  role: string;
  planned_hours: number;
}

export interface Task {
  id: string;
  title: string;
  axis_code: string;
  start_date: string;
  end_date: string;
  status: string;
  done_criteria: string;
  milestone: boolean;
  assignments: Assignment[];
  depends_on: { id: string; title: string }[];
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), retry: false });
}

export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/api/users") });
}

export const STATUS_FR: Record<string, string> = {
  todo: "À faire",
  in_progress: "En cours",
  blocked: "Bloquée",
  done: "Terminée",
};

export const fmtH = (h: number) =>
  `${h.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;

export const fmtDate = (iso: string) => {
  const p = iso.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : iso;
};

export const initials = (name: string) =>
  name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
