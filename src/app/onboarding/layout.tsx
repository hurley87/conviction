import type { Metadata } from "next";
import { AccountProvider } from "@/components/account/account-context";

export const metadata: Metadata = {
  title: "Welcome to Conviction",
  description: "A practice-first introduction to Conviction.",
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccountProvider>{children}</AccountProvider>;
}
