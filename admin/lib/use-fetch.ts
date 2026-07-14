"use client";

import { useCallback, useEffect, useState } from "react";
import { proxy } from "@/lib/client";

/** Fetch a proxied backend GET with loading/error/refetch. */
export function useFetch<T>(path: string): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    proxy(path)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setData(res.body as T);
        else setError(`Error ${res.status}`);
      })
      .catch(() => alive && setError("Network error"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  return { data, loading, error, refetch };
}
