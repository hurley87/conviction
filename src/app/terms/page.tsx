import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/content-page";

export const metadata: Metadata = {
  title: "Terms | Conviction",
  description: "The basic terms for using Conviction.",
};

export default function TermsPage() {
  return (
    <ContentPage
      eyebrow="Terms"
      title="Simple terms for using Conviction"
      intro="These terms explain the basic rules for using Conviction. By using the app, you agree to them."
      updated="July 16, 2026"
    >
      <ContentSection title="Use the app responsibly">
        <p>
          You must be legally allowed to use Conviction where you live. You are
          responsible for your account, your devices, and every transaction you
          approve.
        </p>
        <p>
          Do not use Conviction to break the law, harm others, interfere with
          the service, or access accounts or systems without permission.
        </p>
      </ContentSection>

      <ContentSection title="Trading involves risk">
        <p>
          Crypto assets are risky and can lose value quickly. Transactions may
          fail, cost more than expected, or be impossible to reverse. Only use
          money you can afford to lose.
        </p>
        <p>
          Convictions, market data, summaries, and other content are provided
          for information only. They are not financial, investment, legal, or
          tax advice. You make your own decisions.
        </p>
      </ContentSection>

      <ContentSection title="Third-party services">
        <p>
          Conviction relies on blockchains, wallets, market-data providers,
          routing services, and other third parties. Their services may change,
          fail, or become unavailable. Their own terms may also apply.
        </p>
      </ContentSection>

      <ContentSection title="Your content">
        <p>
          If you post a conviction or other content, you keep ownership of it.
          You give us permission to display, store, and share it as needed to
          operate and improve Conviction.
        </p>
        <p>
          Only post content you have the right to share. Do not post misleading,
          illegal, or harmful content. We may remove content or limit access
          when needed to protect the service or its users.
        </p>
      </ContentSection>

      <ContentSection title="No guarantees">
        <p>
          Conviction is provided as available. We do not promise that it will
          always be secure, accurate, uninterrupted, or error-free. To the
          fullest extent allowed by law, we are not responsible for losses
          caused by market moves, user mistakes, third-party services, or events
          outside our control.
        </p>
      </ContentSection>

      <ContentSection title="Changes">
        <p>
          We may update the app or these terms as Conviction develops. If a
          change is important, we will make reasonable efforts to explain it.
          Continuing to use the app after an update means you accept the new
          terms.
        </p>
      </ContentSection>

      <ContentSection title="Questions">
        <p>
          If you have questions about these terms, contact us through an
          official Conviction channel.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
