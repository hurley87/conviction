"use client";

// Client feed board with mock/live account split (issue #5).
// Saved filter reads the same swipe-state store as the deck (issue #24).

import { useMemo } from "react";
import { Feed, type FeedFilter } from "@/components/feed";
import { useAccount } from "@/components/account/account-context";
import { useConvictionAccount } from "@/hooks/use-conviction-account";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { useBacker } from "@/hooks/use-backer";
import { useSwipeState } from "@/hooks/use-swipe-state";
import { useUASnapshot } from "@/hooks/use-ua-snapshot";
import { IS_LIVE } from "@/lib/env";
import { getUAClient } from "@/lib/ua";
import { MockUAClient, mockTradeSigners } from "@/lib/ua/mock";
import type { ConvictionEntry } from "@/lib/verbs/types";

type FeedBoardProps = {
  convictions: ConvictionEntry[];
  filter?: FeedFilter;
};

function MockFeedBoard({
  convictions,
  filter,
}: {
  convictions: ConvictionEntry[];
  filter: FeedFilter;
}) {
  const { markUpgraded, handle } = useAccount();
  const ua = useMemo(() => new MockUAClient(), []);
  const { balance } = useUASnapshot(ua);
  const { state: swipeState } = useSwipeState(handle);
  const backer = useBacker({
    ua,
    balance,
    signers: mockTradeSigners,
    handle: "demo-trader",
    onUpgraded: markUpgraded,
  });

  return (
    <Feed
      convictions={convictions}
      backer={backer}
      swipeState={swipeState}
      filter={filter}
    />
  );
}

function LiveFeedBoard({
  convictions,
  filter,
}: {
  convictions: ConvictionEntry[];
  filter: FeedFilter;
}) {
  const account = useConvictionAccount();
  const { markUpgraded, handle } = useAccount();
  const signers = useLiveTradeSigners();
  const { state: swipeState } = useSwipeState(handle ?? account.handle);
  const ua = useMemo(
    () => (account.address ? getUAClient(account.address) : null),
    [account.address],
  );
  const backer = useBacker({
    ua,
    balance: account.balance,
    signers,
    handle: account.handle,
    onSignIn: account.login,
    onUpgraded: markUpgraded,
  });

  return (
    <Feed
      convictions={convictions}
      backer={backer}
      swipeState={swipeState}
      filter={filter}
    />
  );
}

export function FeedBoard({
  convictions,
  filter = "all",
}: FeedBoardProps) {
  return IS_LIVE ? (
    <LiveFeedBoard convictions={convictions} filter={filter} />
  ) : (
    <MockFeedBoard convictions={convictions} filter={filter} />
  );
}
