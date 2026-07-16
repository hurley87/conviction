import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/content-page";

export const metadata: Metadata = {
  title: "Privacy | Conviction",
  description: "How Conviction handles information.",
};

export default function PrivacyPage() {
  return (
    <ContentPage
      eyebrow="Privacy"
      title="How we handle your information"
      intro="This page explains what information Conviction may use, why we use it, and the choices you have."
      updated="July 16, 2026"
    >
      <ContentSection title="Information we may collect">
        <p>We may collect information such as:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Account details you provide when signing in.</li>
          <li>Public wallet addresses and public blockchain activity.</li>
          <li>Content you post, save, or interact with.</li>
          <li>
            Basic device, browser, and usage information used to keep the app
            working.
          </li>
          <li>Messages or feedback you send to us.</li>
        </ul>
        <p>
          We do not need your private keys or recovery phrase. Never share them
          with us or anyone claiming to be Conviction support.
        </p>
      </ContentSection>

      <ContentSection title="How we use information">
        <p>We use information to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Provide and secure the app.</li>
          <li>Show your account, balance, activity, and content.</li>
          <li>Process the actions and transactions you request.</li>
          <li>Find bugs, prevent misuse, and improve Conviction.</li>
          <li>Respond when you ask for help.</li>
        </ul>
      </ContentSection>

      <ContentSection title="Public blockchain information">
        <p>
          Blockchain transactions are public. Wallet addresses, transaction
          amounts, token activity, and related records may remain visible even
          if you stop using Conviction. We cannot edit or delete public
          blockchain records.
        </p>
      </ContentSection>

      <ContentSection title="When information is shared">
        <p>
          We may share limited information with service providers that help us
          run Conviction, such as sign-in, infrastructure, analytics, market
          data, and transaction-routing providers.
        </p>
        <p>
          We may also share information when required by law, to protect users
          or the service, or as part of a business transfer. We do not sell your
          personal information.
        </p>
      </ContentSection>

      <ContentSection title="How long we keep information">
        <p>
          We keep information only as long as reasonably needed to run the
          service, meet legal obligations, resolve disputes, and prevent abuse.
          Public blockchain data may remain available permanently.
        </p>
      </ContentSection>

      <ContentSection title="Your choices">
        <p>
          You can stop using Conviction at any time. You may also ask us about
          the personal information we hold or request that we correct or delete
          it, where the law gives you that right.
        </p>
      </ContentSection>

      <ContentSection title="Changes and questions">
        <p>
          We may update this page as Conviction changes. If you have a privacy
          question or request, contact us through an official Conviction
          channel.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
