import { expect, test } from "bun:test";
import { type VaultState, vaultState } from "@/shared/vault";

// store, OS envelope, passphrase envelope, recovery envelope -> state (L32). All 16 rows.
const TABLE: [boolean, boolean, boolean, boolean, VaultState][] = [
  [false, false, false, false, "first-run"],
  [false, false, false, true, "store-missing"],
  [false, false, true, false, "store-missing"],
  [false, false, true, true, "store-missing"],
  [false, true, false, false, "store-missing"],
  [false, true, false, true, "store-missing"],
  [false, true, true, false, "store-missing"],
  [false, true, true, true, "store-missing"],
  [true, false, false, false, "needs-backup"],
  [true, false, false, true, "needs-recovery"],
  [true, false, true, false, "ready"],
  [true, false, true, true, "ready"],
  [true, true, false, false, "ready"],
  [true, true, false, true, "ready"],
  [true, true, true, false, "ready"],
  [true, true, true, true, "ready"],
];

test.each(TABLE)(
  "store %p, OS %p, passphrase %p, recovery %p is %p",
  (store, osEnvelope, passphraseEnvelope, recoveryEnvelope, expected) => {
    expect(vaultState({ store, osEnvelope, passphraseEnvelope, recoveryEnvelope })).toBe(expected);
  },
);
