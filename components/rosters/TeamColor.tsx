import { Button, buttonClass } from "@/components/ui/Button";
import { normalizeHex, slabInk } from "@/lib/game/colors";

/**
 * The team colour, as the roster import read it (Jed, Oct 8: "just have AI
 * infer the color. Get rid of that giant picker"): the crest's pixels on a
 * PDF, else the model's read of the document or of the school's colours. Shown as
 * the card's number block in it, with Clear for a colour that came out wrong;
 * the next import reads it again.
 *
 * Change (Jed, Oct 10: "allow logo color selection if the AI gets it wrong")
 * opens the browser's own colour picker, one small button rather than a grid
 * of swatches. A colour picked here is saved with the team like the rest of
 * its fields, and an import never replaces it, because an import only fills
 * a colour the team does not have (mergeTeam in lib/rosters/editor.ts).
 */
export function TeamColor({
  value,
  onClear,
  onChange,
}: {
  value: string | null;
  onClear: () => void;
  onChange: (hex: string) => void;
}) {
  const color = normalizeHex(value);
  const pick = (
    <label className={buttonClass("outlined", "relative")}>
      {color ? "Change" : "Pick a colour"}
      <input
        type="color"
        aria-label="Team colour"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        value={color ?? "#000000"}
        onChange={(event) => {
          const hex = normalizeHex(event.target.value);
          if (hex) onChange(hex);
        }}
      />
    </label>
  );
  if (!color) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">None yet. The next roster import reads it from the logo or the school&apos;s colours.</span>
        {pick}
      </span>
    );
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
      {pick}
      <Button onClick={onClear}>Clear</Button>
    </span>
  );
}
