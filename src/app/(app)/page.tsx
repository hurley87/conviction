import { DeckBoard } from "@/components/deck/deck-board";
import { listDeckCards } from "@/lib/convictions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cards = await listDeckCards();

  return <DeckBoard cards={cards} />;
}
