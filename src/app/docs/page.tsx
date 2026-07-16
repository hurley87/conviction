import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/content-page";

export const metadata: Metadata = {
  title: "Docs | Conviction",
  description: "A simple guide to using Conviction.",
};

const STEPS = [
  {
    number: "01",
    title: "Sign in",
    text: "Sign in to create your Conviction account. Your account brings supported assets together into one balance.",
  },
  {
    number: "02",
    title: "Add money",
    text: "Open Add money and choose a deposit address. Always check the asset and network before sending.",
  },
  {
    number: "03",
    title: "Explore the deck",
    text: "The deck shows trades with a clear thesis, timing, risks, and the facts behind each idea.",
  },
  {
    number: "04",
    title: "Back a conviction",
    text: "Choose an amount, review the quote, and confirm. Conviction handles the route across supported networks.",
  },
] as const;

export default function DocsPage() {
  return (
    <ContentPage
      eyebrow="Docs"
      title="How Conviction works"
      intro="Conviction lets you explore and back transparent onchain trades without managing bridges or switching networks yourself."
    >
      <ContentSection title="Getting started">
        <div className="grid gap-3 sm:grid-cols-2">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="rounded-card border border-line bg-surface p-5 shadow-sm"
            >
              <p className="font-mono text-xs font-bold text-ink-3">
                {step.number}
              </p>
              <h3 className="mt-3 text-base font-extrabold text-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-ink-2">{step.text}</p>
            </div>
          ))}
        </div>
      </ContentSection>

      <ContentSection title="One balance, multiple networks">
        <p>
          Conviction uses a Universal Account to show supported assets from
          Solana, Base, and Arbitrum as one balance. When you make a trade, the
          app finds a route from the assets you already hold.
        </p>
        <p>
          You will still see the network details before you deposit, withdraw,
          or confirm a transaction. Read them carefully—onchain transactions
          cannot usually be reversed.
        </p>
      </ContentSection>

      <ContentSection title="What is a conviction?">
        <p>
          A conviction is a trade someone has made and chosen to explain
          publicly. It can include their thesis, why they acted now, what could
          prove them wrong, and supporting research.
        </p>
        <p>
          A conviction is not a promise of profit or personal financial advice.
          Use it as information, do your own research, and only risk what you
          can afford to lose.
        </p>
      </ContentSection>

      <ContentSection title="Quotes, fees, and confirmation">
        <p>
          Before a trade, Conviction shows an estimated route, amount received,
          and fees. Prices can move between the quote and the final transaction.
          Review the details before confirming.
        </p>
      </ContentSection>

      <ContentSection title="Withdrawals">
        <p>
          You can withdraw supported assets from Settings. Check the destination
          address, asset, and network before confirming. Sending to the wrong
          address or network may permanently lose your funds.
        </p>
      </ContentSection>

      <ContentSection title="Need help?">
        <p>
          Conviction is still early. If something looks wrong, stop before
          confirming a transaction and contact us through an official
          Conviction channel. Never share a password, recovery phrase, or
          private key with anyone.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
