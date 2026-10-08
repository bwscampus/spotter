import { Button } from "@/components/ui/Button";
import { normalizeHex, slabInk } from "@/lib/game/colors";

/**
 * The team colour, as the roster import read it (Jed, Oct 8: "just have AI
 * infer the color. Get rid of that giant picker"): the crest's pixels on a
 * PDF, else Claude's read of the document or of the school's colours. Shown as
 * the card's number block in it, with Clear for a colour that came out wrong;
 * the next import reads it again.
 */
export function TeamColor({ value, onClear }: { value: string | null; onClear: () => void }) {
  const color = normalizeHex(value);
  if (!color) {
    return <span className="text-[13px] text-muted">None yet. The next roster import reads it from the logo or the school&apos;s colours.</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="flex h-[30px] w-10 items-center justify-center rounded-[3px] border border-line text-[13px] font-bold"
        style={{ background: color, color: slabInk(color) }}
      >
        22
      </span>
      <span className="font-num text-[12px] text-ink-2">{color}</span>
      <Button onClick={onClear}>Clear</Button>
    </span>
  );
}
