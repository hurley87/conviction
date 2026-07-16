"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchTradeTokens,
  type TradeToken,
} from "@/lib/lifi-tokens";

type State = {
  tokens: TradeToken[];
  loading: boolean;
  error: string | null;
};

export function useTradeTokens() {
  const [state, setState] = useState<State>({
    tokens: [],
    loading: true,
    error: null,
  });

  const refresh = useCallback(async (force = false) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const tokens = await fetchTradeTokens(force);
      setState({ tokens, loading: false, error: null });
    } catch (error) {
      setState({
        tokens: [],
        loading: false,
        error:
          error instanceof Error ? error.message : "Could not load tokens.",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchTradeTokens()
      .then((tokens) => {
        if (!cancelled) setState({ tokens, loading: false, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          tokens: [],
          loading: false,
          error:
            error instanceof Error ? error.message : "Could not load tokens.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...state, refresh };
}
