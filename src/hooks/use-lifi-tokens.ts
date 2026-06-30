"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchLiFiTokens,
  findTokenForAsset,
  type FeedToken,
} from "@/lib/lifi-tokens";
import type { ProductAsset } from "@/lib/verbs/types";

type LiFiTokensState = {
  tokens: FeedToken[];
  loading: boolean;
  error: string | null;
};

export function useLiFiTokens() {
  const [state, setState] = useState<LiFiTokensState>({
    tokens: [],
    loading: true,
    error: null,
  });

  const refresh = useCallback(async (force = false) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const tokens = await fetchLiFiTokens(force);
      setState({ tokens, loading: false, error: null });
    } catch (e) {
      setState({
        tokens: [],
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load tokens",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetchLiFiTokens()
      .then((tokens) => {
        if (!cancelled) {
          setState({ tokens, loading: false, error: null });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setState({
            tokens: [],
            loading: false,
            error: e instanceof Error ? e.message : "Failed to load tokens",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const tokenForAsset = useCallback(
    (asset: ProductAsset) => findTokenForAsset(state.tokens, asset),
    [state.tokens],
  );

  return { ...state, refresh, tokenForAsset };
}
