"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { useLive } from "@/components/clipping/useLive";
import { useShellAccount } from "@/components/clipping/web/WebShell";
import type { Project, ProjectPage } from "@/lib/clipping-types";

const ACTIVE = new Set(["queued", "running"]);

/**
 * The founder's uploads, on today's `/api/v1/projects` routes: the same reads and writes the old
 * My projects page made (U7b parity), so nothing it could do is lost when Studio replaces it.
 */
export function useProjects(query: string) {
  const { userId } = useShellAccount();
  const [projects, setProjects] = useState<Project[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const request = useRef(0);
  const deleted = useRef(new Set<string>());

  const load = useCallback(async (next: { query: string; cursor?: string | null }) => {
    const seq = ++request.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (next.query.trim()) params.set("q", next.query.trim());
      if (next.cursor) params.set("cursor", next.cursor);
      const page = await api<ProjectPage>(`/projects?${params}`);
      if (seq !== request.current) return;
      setProjects((current) =>
        (next.cursor ? [...current, ...page.items] : page.items).filter((item) => !deleted.current.has(item.id)),
      );
      setCursor(page.next_cursor);
      setLoaded(true);
    } catch (err) {
      if (seq !== request.current) return;
      setError(err instanceof ApiError ? err.message : "Could not load your uploads.");
    } finally {
      if (seq === request.current) setLoading(false);
    }
  }, []);

  // Filter as the founder types, but wait 250 ms: one keyset query per keystroke is wasted work.
  useEffect(() => {
    const timer = setTimeout(() => void load({ query }), 250);
    return () => clearTimeout(timer);
  }, [query, load]);

  // A running upload changes on its own: refresh only the cards on screen, not the whole list
  // (re-reading would drop pages already loaded).
  const hasActive = projects.some((item) => ACTIVE.has(item.status));
  const refreshStatuses = useCallback(async () => {
    try {
      const page = await api<ProjectPage>("/projects?limit=24");
      const fresh = new Map(page.items.map((item) => [item.id, item]));
      setProjects((current) => current.map((item) => fresh.get(item.id) ?? item));
    } catch {
      // Background refresh only; the next event tries again.
    }
  }, []);
  useLive("jobs", userId && `user_id=eq.${userId}`, () => void refreshStatuses(), Boolean(userId) && hasActive, true, "studio");

  const replace = useCallback(
    (saved: Project) => setProjects((current) => current.map((item) => (item.id === saved.id ? { ...item, ...saved } : item))),
    [],
  );

  async function act(id: string, action: () => Promise<void>, fallback: string) {
    setError(null);
    setBusyId(id);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusyId(null);
    }
  }

  return {
    projects,
    loaded,
    loading,
    error,
    busyId,
    hasMore: !!cursor,
    clearError: () => setError(null),
    loadMore: () => void load({ query, cursor }),
    toggleFavorite: (project: Project) => {
      const favorite = !project.favorite;
      replace({ ...project, favorite });
      return act(
        project.id,
        async () => {
          try {
            replace(await api<Project>(`/projects/${project.id}`, jsonBody({ favorite }, "PATCH")));
          } catch (err) {
            replace(project);
            throw err;
          }
        },
        "Could not update that upload.",
      );
    },
    rename: (project: Project, title: string) =>
      act(project.id, async () => replace(await api<Project>(`/projects/${project.id}`, jsonBody({ title }, "PATCH"))), "Could not rename that upload."),
    retry: (project: Project) =>
      act(project.id, async () => replace(await api<Project>(`/jobs/${project.id}/retry`, jsonBody({}))), "Could not process that video again."),
    cancel: (project: Project) =>
      act(project.id, async () => replace(await api<Project>(`/projects/${project.id}/cancel`, jsonBody({}))), "Could not cancel processing."),
    remove: (project: Project) =>
      act(
        project.id,
        async () => {
          const result = await api<{ deleted: boolean }>(`/projects/${project.id}`, { method: "DELETE" });
          if (!result.deleted) throw new Error("Could not delete that upload.");
          deleted.current.add(project.id);
          setProjects((current) => current.filter((item) => item.id !== project.id));
        },
        "Could not delete that upload.",
      ),
    replace,
  };
}

export type ProjectsApi = ReturnType<typeof useProjects>;
