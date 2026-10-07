// =============================================================================
// How a jersey number is said out loud.
//
// Deepgram's numerals option hands back "23" for "twenty three", and when it
// does there is nothing left to match: the decision was made inside Deepgram.
// The forms here are for the times it does not. "Number twenty free" comes back
// as a 20 and a word, "number for teen" as two words, and neither is a jersey
// until it is scored as the sound of one.
//
// Pure, and the only place that knows how a number is pronounced.
// =============================================================================

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = [
  "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Said for a zero inside a number: "oh seven". */
const OH = "oh";

/**
 * Every way one jersey gets said, longest-sounding first.
 *
 * "23" is "twenty three" and also "two three", because both are said. "00" is
 * "double zero" and the other three ways a booth says it. A leading zero keeps
 * its zero: "07" is never "seven", which is a different player.
 */
export function jerseySpokenForms(jersey: string): string[] {
  const digits = jersey.trim();
  if (!/^\d+$/.test(digits)) return [];

  const forms: string[] = [];
  const add = (form: string) => {
    if (form && !forms.includes(form)) forms.push(form);
  };
  const perDigit = (separator = " ") => [...digits].map((digit) => ONES[Number(digit)]).join(separator);

  if (digits.length === 1) {
    add(ONES[Number(digits)]);
    if (digits === "0") add(OH);
    return forms;
  }

  if (digits.length === 2) {
    const [tens, ones] = [Number(digits[0]), Number(digits[1])];
    if (digits === "00") {
      add("double zero");
      add("zero zero");
      add("double oh");
      add(`${OH} ${OH}`);
      return forms;
    }
    if (tens === 0) {
      // "07" is "oh seven", and the zero is part of who they are.
      add(`${OH} ${ONES[ones]}`);
      add(`zero ${ONES[ones]}`);
      return forms;
    }
    if (tens === 1) add(TEENS[ones]);
    else if (ones === 0) add(TENS[tens]);
    else add(`${TENS[tens]} ${ONES[ones]}`);
    add(perDigit());
    return forms;
  }

  // Three digits and up are rare and never said as one word. Digit by digit is
  // how they are called: "one oh five".
  add(perDigit());
  return forms;
}

/** The first form, which is how a number is normally said. Used to read digits back as words. */
export function jerseyAsSpoken(jersey: string): string {
  return jerseySpokenForms(jersey)[0] ?? jersey;
}
