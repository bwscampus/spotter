import { MiniCard } from "@/components/ui/MiniCard";
import { sampleCard } from "@/lib/demo/sample";
import { TextLink } from "@/components/ui/Button";

/**
 * An empty list's picture (the Broadcast look, Nov 19): what every player on a
 * saved roster becomes, with a way to see it move. The player is the demo's,
 * made up, never anyone's own.
 */
export function EmptyCardPreview() {
  const card = sampleCard("Langan");
  if (!card) return null;
  return (
    <figure className="flex max-w-[640px] flex-col gap-2">
      <MiniCard card={card} />
      <figcaption className="text-[14px] text-muted">
        Every player on a roster becomes a card like this, up the moment their name or number is said.{" "}
        <TextLink href="/demo">Watch the demo</TextLink>
      </figcaption>
    </figure>
  );
}
