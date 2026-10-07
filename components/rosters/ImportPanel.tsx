"use client";

import { useRef, useState } from "react";
import { WaitingNote, useApproved } from "@/components/auth/Approval";
import { sizeBucket, type IMPORT_KINDS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/track";
import { MAX_IMAGES, MAX_TEXT_CHARS } from "@/lib/rosters/extractErrors";
import { detectFormat, ImportProblem, prepareImages, readTable } from "@/lib/rosters/importFiles";
import type { ImportFormat } from "@/lib/rosters/types";

const LABEL = "text-[11px] font-semibold uppercase tracking-widest text-neutral-500";
const BUTTON =
  "cursor-pointer rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:border-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:border-neutral-300";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.csv,.tsv,.xlsx,application/pdf,image/*,text/csv";

type ImportKind = (typeof IMPORT_KINDS)[number];
type Props = Record<string, number | boolean | string>;

export interface ImportPanelProps<T> {
  kind: ImportKind;
  /** The route that reads the upload. It runs requireApprovedUser first. */
  endpoint: string;
  title: string;
  /** What the thing being imported is called in messages: "roster", "stats sheet". */
  noun: string;
  pastePlaceholder: string;
  /** Sent with every upload, beside the file or text: the team a stats sheet is for. */
  fields?: Record<string, string>;
  /** Whether a 200 body is the result this panel expects. */
  isResult: (body: unknown) => body is T;
  /** Counts for prep.import_finished on success. Codes and counts only. */
  finishedProps: (result: T) => Props;
  /** Warnings to show under the panel after a successful import. */
  warningsOf?: (result: T) => string[];
  onResult: (result: T) => void;
  /** Turns the panel off for a reason other than approval, with that reason shown. */
  blockedBy?: string | null;
}

/**
 * Import from any of the four formats (docs/V3_DEFINITION.md 6.2), for a
 * roster or a stats sheet: files go in the drop zone, text in the box, and
 * either way the route's answer comes back through onResult.
 *
 * Every import calls Anthropic, so an account still waiting for approval sees
 * this disabled with the note.
 */
export function ImportPanel<T>({
  kind,
  endpoint,
  title,
  noun,
  pastePlaceholder,
  fields,
  isResult,
  finishedProps,
  warningsOf,
  onResult,
  blockedBy = null,
}: ImportPanelProps<T>) {
  const approved = useApproved();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const disabled = !approved || busy !== null || blockedBy !== null;

  async function run(format: ImportFormat, build: () => Promise<{ form: FormData; bytes: number; pages?: number }>) {
    setError(null);
    setWarnings([]);
    setBusy(format === "text" ? `Reading the pasted ${noun}...` : `Reading the ${noun}...`);
    const started = performance.now();

    let form: FormData;
    try {
      const built = await build();
      form = built.form;
      for (const [name, value] of Object.entries(fields ?? {})) form.set(name, value);
      track("prep.import_started", {
        kind,
        format,
        size_bucket: sizeBucket(built.bytes),
        ...(built.pages ? { pages: built.pages } : {}),
      });
    } catch (problem) {
      setBusy(null);
      setError({ message: problem instanceof ImportProblem ? problem.message : "Could not read that file.", code: null });
      return;
    }

    const finished = (props: Props) =>
      track("prep.import_finished", { kind, format, ms: Math.round(performance.now() - started), ...props });

    let response: Response;
    try {
      response = await fetch(endpoint, { method: "POST", body: form });
    } catch {
      setBusy(null);
      setError({ message: "Could not reach Spotter. Check the connection and try again.", code: "network" });
      finished({ ok: false, fail_code: "network" });
      return;
    }

    const body = (await response.json().catch(() => null)) as unknown;
    setBusy(null);

    if (!response.ok || !isResult(body)) {
      const failure = (body ?? {}) as { error?: unknown; code?: unknown };
      // Vercel refuses a body over 4.5 MB before the route sees it, and says so in HTML.
      const code =
        typeof failure.code === "string" ? failure.code : response.status === 413 ? "payload_too_large" : "unknown";
      const message =
        typeof failure.error === "string"
          ? failure.error
          : response.status === 413
            ? "That file is too large to upload. Export a smaller PDF or take a screenshot instead."
            : `Could not read a ${noun} from this import. Try again.`;
      setError({ message, code });
      finished({ ok: false, fail_code: code });
      return;
    }

    setWarnings(warningsOf?.(body) ?? []);
    finished({ ok: true, ...finishedProps(body) });
    onResult(body);
  }

  async function importFiles(list: FileList | File[]) {
    const files = [...list];
    let format: Exclude<ImportFormat, "text">;
    try {
      format = detectFormat(files);
    } catch (problem) {
      setError({ message: problem instanceof ImportProblem ? problem.message : "Could not read that file.", code: null });
      return;
    }

    await run(format, async () => {
      const form = new FormData();
      form.set("format", format);
      if (format === "pdf") {
        form.append("file", files[0], `${kind}.pdf`);
        return { form, bytes: files[0].size };
      }
      if (format === "image") {
        setBusy("Preparing the images...");
        const images = await prepareImages(files);
        images.forEach((image, index) => form.append("file", image, `${kind}-${index + 1}`));
        return { form, bytes: images.reduce((sum, image) => sum + image.size, 0), pages: images.length };
      }
      const text = await readTable(files[0], format);
      form.set("text", text);
      return { form, bytes: text.length };
    });
  }

  async function importPasted() {
    await run("text", async () => {
      if (pasted.trim().length === 0) throw new ImportProblem(`Paste the ${noun} first.`);
      const form = new FormData();
      form.set("format", "text");
      form.set("text", pasted);
      return { form, bytes: pasted.length };
    });
  }

  const pasteId = `${kind}-paste`;

  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <p className={LABEL}>{title}</p>
      <WaitingNote className="mt-2" />
      {approved && blockedBy && <p className="mt-2 text-sm font-semibold text-amber-700">{blockedBy}</p>}

      <div
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled && event.dataTransfer.files.length > 0) void importFiles(event.dataTransfer.files);
        }}
        className={`mt-3 flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center ${
          dragging ? "border-neutral-700 bg-neutral-50" : "border-neutral-300"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <p className="text-sm text-neutral-700">
          Drop a PDF, up to {MAX_IMAGES} screenshots or photos, or a CSV or Excel file.
        </p>
        <button type="button" disabled={disabled} onClick={() => picker.current?.click()} className={BUTTON}>
          Choose files
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) void importFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="mt-4">
        <label htmlFor={pasteId} className={LABEL}>
          Or paste the {noun}
        </label>
        <textarea
          id={pasteId}
          disabled={disabled}
          rows={4}
          maxLength={MAX_TEXT_CHARS}
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          placeholder={pastePlaceholder}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-neutral-50 p-2 text-sm text-neutral-900 focus:border-neutral-600 focus:outline-none disabled:opacity-60"
        />
        <button type="button" disabled={disabled || pasted.trim().length === 0} onClick={() => void importPasted()} className={`mt-1 ${BUTTON}`}>
          Import pasted text
        </button>
      </div>

      {busy && <p className="mt-3 text-sm font-semibold text-neutral-700">{busy}</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-amber-700">
          {error.message}
          {error.code && <span className="ml-2 font-mono text-xs font-normal text-neutral-500">{error.code}</span>}
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="mt-2 text-sm text-amber-700">
          {warning}
        </p>
      ))}
    </section>
  );
}
