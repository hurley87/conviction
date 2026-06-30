"use client";

import { PRIMARY } from "@/components/button-styles";

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
      className={PRIMARY}
    >
      {isFunding ? "Adding money…" : "Add money with a card"}
    </button>
  );
}
