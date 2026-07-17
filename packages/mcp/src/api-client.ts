export type RedeemedAgent = {
  agentId: string;
  handle: string;
  operatorHandle: string;
  address: string | null;
  status: string;
  publicStatus: string;
  actionPolicy: {
    trade: boolean;
    back: boolean;
    publish: boolean;
  };
  maxTradeUsd: number;
  spendBudgetUsd: number;
  fundingReady: boolean;
};

export type ApiErrorBody = {
  error?: { code?: string; message?: string };
};

export class ConvictionApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ConvictionApiError";
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    throw new ConvictionApiError(
      payload.error?.code ?? "unavailable",
      payload.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
    );
  }
  return payload;
}

export async function redeemProvisioningCode(options: {
  apiBaseUrl: string;
  code: string;
  signerAddress: string;
  proofSignature: string;
  fetchImpl?: typeof fetch;
}): Promise<RedeemedAgent> {
  const base = options.apiBaseUrl.replace(/\/$/, "");
  const payload = await postJson<{ agent: RedeemedAgent }>(
    `${base}/api/agents/redeem`,
    {
      code: options.code,
      signerAddress: options.signerAddress,
      proofSignature: options.proofSignature,
    },
    options.fetchImpl ?? fetch,
  );
  return payload.agent;
}

export async function completeBackupVerification(options: {
  apiBaseUrl: string;
  agentId: string;
  signerAddress: string;
  proofSignature: string;
  fetchImpl?: typeof fetch;
}): Promise<RedeemedAgent> {
  const base = options.apiBaseUrl.replace(/\/$/, "");
  const payload = await postJson<{ agent: RedeemedAgent }>(
    `${base}/api/agents/complete-backup`,
    {
      agentId: options.agentId,
      signerAddress: options.signerAddress,
      proofSignature: options.proofSignature,
    },
    options.fetchImpl ?? fetch,
  );
  return payload.agent;
}
