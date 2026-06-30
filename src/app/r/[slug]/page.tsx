import { notFound } from "next/navigation";
import { getStoredReceipt } from "@/lib/receipts";
import { ReceiptView } from "@/components/receipt-view";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const receipt = await getStoredReceipt(slug);
  if (!receipt) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#06060d] px-6 py-12 text-white">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Conviction</h1>
        <p className="mt-1 text-sm text-[#6b7099]">Trade receipt</p>
      </div>
      <ReceiptView receipt={receipt} />
    </main>
  );
}
