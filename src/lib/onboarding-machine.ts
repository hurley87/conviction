import type { IdentitySource } from "@/lib/identity";

export const ONBOARDING_VERSION = 1;

export const ONBOARDING_STEPS = [
  "identity",
  "account",
  "deck",
  "ask",
  "trade",
  "conviction",
  "ready",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type DeckGesture = "skip" | "save" | "back";
export type TradePhase = "sizing" | "review" | "pending" | "receipt";

export type OnboardingState = {
  step: number;
  deckGestures: Record<DeckGesture, boolean>;
  askAnswered: boolean;
  tradePhase: TradePhase;
  tradeSize: number;
  convictionPreviewed: boolean;
};

export type OnboardingAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "go"; step: number }
  | { type: "deck"; gesture: DeckGesture }
  | { type: "ask" }
  | { type: "trade-size"; size: number }
  | { type: "trade-phase"; phase: TradePhase }
  | { type: "conviction-preview" };

export const ONBOARDING_STEP_COPY: Record<
  OnboardingStep,
  readonly [title: string, description: string]
> = {
  identity: [
    "Your public identity",
    "Choose how people will recognize your reasoning.",
  ],
  account: [
    "One account, every move",
    "Your embedded wallet and unified balance stay out of the way.",
  ],
  deck: [
    "Learn the deck",
    "Use a practice card to learn the three daily gestures.",
  ],
  ask: [
    "Ask Conviction",
    "See how research becomes a clear, trade-ready brief.",
  ],
  trade: [
    "Practice a trade",
    "Size, review, confirm, and receive a simulated receipt.",
  ],
  conviction: [
    "Share your reasoning",
    "Draft a public thesis without posting anything.",
  ],
  ready: [
    "You’re ready",
    "The real app stays deliberate: you choose every action.",
  ],
};

export function createOnboardingState(step = 0): OnboardingState {
  return {
    step: Math.max(0, Math.min(step, ONBOARDING_STEPS.length - 1)),
    deckGestures: { skip: false, save: false, back: false },
    askAnswered: false,
    tradePhase: "sizing",
    tradeSize: 25,
    convictionPreviewed: false,
  };
}

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  switch (action.type) {
    case "next":
      return {
        ...state,
        step: Math.min(state.step + 1, ONBOARDING_STEPS.length - 1),
      };
    case "back":
      return { ...state, step: Math.max(state.step - 1, 0) };
    case "go":
      return {
        ...state,
        step: Math.max(0, Math.min(action.step, ONBOARDING_STEPS.length - 1)),
      };
    case "deck":
      return {
        ...state,
        deckGestures: { ...state.deckGestures, [action.gesture]: true },
      };
    case "ask":
      return { ...state, askAnswered: true };
    case "trade-size":
      return { ...state, tradeSize: Math.max(5, Math.min(action.size, 100)) };
    case "trade-phase":
      return { ...state, tradePhase: action.phase };
    case "conviction-preview":
      return { ...state, convictionPreviewed: true };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function onboardingProgress(step: number) {
  return Math.round(((step + 1) / ONBOARDING_STEPS.length) * 100);
}

export function currentOnboardingStep(state: OnboardingState): OnboardingStep {
  return ONBOARDING_STEPS[state.step] ?? "identity";
}

export function canAdvance(
  step: OnboardingStep,
  state: OnboardingState,
  identity: {
    source: IdentitySource | null;
    usernameDraftValid: boolean;
  },
): boolean {
  switch (step) {
    case "identity":
      return identity.source === "twitter" || identity.usernameDraftValid;
    case "account":
      return true;
    case "deck":
      return Object.values(state.deckGestures).every(Boolean);
    case "ask":
      return state.askAnswered;
    case "trade":
      return state.tradePhase === "receipt";
    case "conviction":
      return state.convictionPreviewed;
    case "ready":
      return true;
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

export function onboardingStorageKey(privyId: string) {
  return `conviction:onboarding:v${ONBOARDING_VERSION}:${privyId}`;
}

type LessonStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readCurrentLesson(storage: LessonStorage, privyId: string) {
  const raw = storage.getItem(onboardingStorageKey(privyId));
  const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(parsed, ONBOARDING_STEPS.length - 1))
    : 0;
}

export function writeCurrentLesson(
  storage: LessonStorage,
  privyId: string,
  step: number,
) {
  storage.setItem(onboardingStorageKey(privyId), String(step));
}

export function clearCurrentLesson(storage: LessonStorage, privyId: string) {
  storage.removeItem(onboardingStorageKey(privyId));
}
