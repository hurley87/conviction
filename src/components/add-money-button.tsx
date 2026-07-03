"use client";

import { PRIMARY_LIGHT } from "@/components/button-styles";

export function AddMoneyButton({
  onAdd,
  isFunding,
  disabled = false,
}: {
  onAdd: () => void | Promise<void>;
  isFunding?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || isFunding;

  return (
    <button
      type="button"
      onClick={() => void onAdd()}
      disabled={isDisabled}
      className={PRIMARY_LIGHT}
    >
      {isFunding ? "Adding money…" : "Add money with a card"}
    </button>
  );
}
