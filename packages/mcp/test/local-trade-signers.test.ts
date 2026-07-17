import { describe, expect, it } from "vitest";
import {
  Signature,
  Wallet,
  getBytes,
  verifyAuthorization,
  verifyMessage,
} from "ethers";

import { createLocalTradeSigners } from "../src/local-trade-signers.js";

/** Fixed key for deterministic vector + recovered-address checks (ADR 0045). */
const FIXED_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const FIXED_ADDRESS = "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c";
const ROOT_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXPECTED_ROOT_SIG =
  "0xf335de81fa20d62f410689f0e2e8533ed77b830bc30768eb4ddf32dfca6aef3a19db1d1d89040cd1cbf013d43ef2de2f3720785f44fc86a56935ddd1ed9621561c";
const DELEGATION = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 42161;
const NONCE = 0;
const EXPECTED_7702_SIG =
  "0x8cc4714333730c302bc8eb5587e0d2dd388f4b817eb9925f29bec8618990adb13443805403a8c244afdd4f695c68712f5fba552f9d3d7364227a10c2f3ecee041b";

describe("createLocalTradeSigners", () => {
  it("matches the fixed rootHash vector and recovers the owner address", async () => {
    const wallet = new Wallet(FIXED_PRIVATE_KEY);
    expect(wallet.address).toBe(FIXED_ADDRESS);

    const signers = createLocalTradeSigners(wallet);
    const signature = await signers.signRootHash(ROOT_HASH);

    expect(signature).toBe(EXPECTED_ROOT_SIG);
    expect(verifyMessage(getBytes(ROOT_HASH), signature)).toBe(FIXED_ADDRESS);
  });

  it("signs decoded rootHash bytes, not hexadecimal text characters", async () => {
    const wallet = new Wallet(FIXED_PRIVATE_KEY);
    const signers = createLocalTradeSigners(wallet);

    const correct = await signers.signRootHash(ROOT_HASH);
    const wrongTextSig = await wallet.signMessage(ROOT_HASH);

    expect(correct).not.toBe(wrongTextSig);
    expect(verifyMessage(getBytes(ROOT_HASH), correct)).toBe(FIXED_ADDRESS);
    expect(verifyMessage(ROOT_HASH, wrongTextSig)).toBe(FIXED_ADDRESS);
    expect(verifyMessage(getBytes(ROOT_HASH), wrongTextSig)).not.toBe(
      FIXED_ADDRESS,
    );
  });

  it("matches the fixed EIP-7702 vector shape and recovers the owner", async () => {
    const wallet = new Wallet(FIXED_PRIVATE_KEY);
    const signers = createLocalTradeSigners(wallet);

    const serialized = await signers.sign7702({
      contractAddress: DELEGATION,
      chainId: CHAIN_ID,
      nonce: NONCE,
    });

    expect(serialized).toBe(EXPECTED_7702_SIG);

    const parsed = Signature.from(serialized);
    expect(parsed.r).toBe(
      "0x8cc4714333730c302bc8eb5587e0d2dd388f4b817eb9925f29bec8618990adb1",
    );
    expect(parsed.s).toBe(
      "0x3443805403a8c244afdd4f695c68712f5fba552f9d3d7364227a10c2f3ecee04",
    );
    expect(parsed.yParity).toBe(0);
    expect(parsed.v).toBe(27);

    const recovered = verifyAuthorization(
      { address: DELEGATION, chainId: CHAIN_ID, nonce: NONCE },
      parsed,
    );
    expect(recovered).toBe(FIXED_ADDRESS);
  });

  it("produces browser-equivalent serialization for the same signing request", async () => {
    // Browser path: Privy signAuthorization → Signature.from({ r, s, v }).serialized
    // Local path: wallet.authorize → authorization.signature.serialized
    // Both must recover the same owner for equivalent inputs (ADR 0045).
    const wallet = new Wallet(FIXED_PRIVATE_KEY);
    const local = createLocalTradeSigners(wallet);

    const localSerialized = await local.sign7702({
      contractAddress: DELEGATION,
      chainId: CHAIN_ID,
      nonce: NONCE,
    });

    const authorization = await wallet.authorize({
      address: DELEGATION,
      chainId: CHAIN_ID,
      nonce: NONCE,
    });
    const browserEquivalent = Signature.from({
      r: authorization.signature.r,
      s: authorization.signature.s,
      v: authorization.signature.v,
    }).serialized;

    expect(localSerialized).toBe(browserEquivalent);
    expect(
      verifyAuthorization(
        { address: DELEGATION, chainId: CHAIN_ID, nonce: NONCE },
        Signature.from(localSerialized),
      ),
    ).toBe(FIXED_ADDRESS);
  });
});
