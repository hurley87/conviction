"use client";

// Client feed board with mock/live account split (issue #5).

import { useMemo } from "react";
import { Feed } from "@/components/feed";
import { useConvictionAccount } from "@/hooks/use-conviction-account";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { useBacker } from "@/hooks/use-backer";
import { useUASnapshot } from "@/hooks/use-ua-snapshot";
import { IS_LIVE } from "@/lib/env";
import { getUAClient } from "@/lib/ua";
import { MockUAClient, mockTradeSigners } from "@/lib/ua/mock";
import type { ConvictionEntry } from "@/lib/verbs/types";

type FeedBoardProps = {
  convictions: ConvictionEntry[];
};

function MockFeedBoard({ convictions }: FeedBoardProps) {
  const ua = useMemo(() => new MockUAClient(), []);
  const { balance } = useUASnapshot(ua);
  const backer = useBacker({
    ua,
    balance,
    signers: mockTradeSigners,
    handle: "demo-trader",
  });

  return <Feed convictions={convictions} backer={backer} />;
}

function LiveFeedBoard({ convictions }: FeedBoardProps) {
  const account = useConvictionAccount();
  const signers = useLiveTradeSigners();
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
  });

  return <Feed convictions={convictions} backer={backer} />;
}

export function FeedBoard({ convictions }: FeedBoardProps) {
  return IS_LIVE ? (
    <LiveFeedBoard convictions={convictions} />
  ) : (
    <MockFeedBoard convictions={convictions} />
  );
}
