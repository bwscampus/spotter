"use client";

import { useEffect, useRef, useState } from "react";
import { useUploadTerms } from "@/components/auth/UploadTerms";
import { Button } from "@/components/ui/Button";
import { LABEL } from "@/components/ui/Field";
import { sizeBucket, type IMPORT_KINDS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/track";
import { MAX_IMAGES, MAX_TEXT_CHARS } from "@/lib/rosters/extractErrors";
import { detectFormat, ImportProblem, isPlainText, pastedTextProblem, prepareImages, readTable } from "@/lib/rosters/importFiles";
import type { ImportFormat } from "@/lib/rosters/types";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.csv,.tsv,.xlsx,.txt,.md,application/pdf,image/*,text/csv,text/plain";

type ImportKind = (typeof IMPORT_KINDS)[number];
type Props = Record<string, number | boolean | string>;

export interface ImportPanelProps<T> {
  kind: ImportKind;
  /** The route that reads the upload. It runs requireUser first. */
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
  /** `source` is what was read: the file name, the files' names, or "Pasted text". */
  onResult: (result: T, source: string) => void;
  /** Turns the panel off, with the reason shown. */
  blockedBy?: string | null;
  /**
   * "box" is the panel itself, inside a dashed box. "bar" collapses it to one
   * dashed 30px bar that still takes a dropped file, and expands to the box.
   */
  layout?: "box" | "bar";
  /** The collapsed bar's line: "Drop a roster PDF, CSV or photo here, or click to expand." */
  barHint?: string;
  /** Whether the bar is expanded, when its owner decides (the toolbar's Import button). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Import from any of the four formats (docs/V3_DEFINITION.md 6.2), for a
 * roster or a stats sheet: files go in the drop zone, text in the box, and
 * either way the route's answer comes back through onResult.
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
  layout = "box",
  barHint = "Drop a file here, or click to expand.",
  open: openProp,
  onOpenChange,
}: ImportPanelProps<T>) {
  const terms = useUploadTerms();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const disabled = !terms.accepted || busy !== null || blockedBy !== null;
  const [openState, setOpenState] = useState(false);
  const open = layout === "box" || (openProp ?? openState);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  // Escape closes the expanded bar, like anything else open.
  useEffect(() => {
    if (layout !== "bar" || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenState(false);
      onOpenChange?.(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [layout, open, onOpenChange]);

  async function run(
    format: ImportFormat,
    source: string,
    build: () => Promise<{ form: FormData; bytes: number; pages?: number; notes?: string[] }>,
  ) {
    setError(null);
    setWarnings([]);
    setBusy(format === "text" ? `Reading the pasted ${noun}...` : `Reading the ${noun}...`);
    const started = performance.now();

    let form: FormData;
    let notes: string[] = [];
    try {
      const built = await build();
      form = built.form;
      notes = built.notes ?? [];
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

    setWarnings([...notes, ...(warningsOf?.(body) ?? [])]);
    finished({ ok: true, ...finishedProps(body) });
    // Read: the bar folds away so the review is what is in front of you.
    if (layout === "bar") setOpen(false);
    onResult(body, source);
  }

  async function importFiles(list: FileList | File[]) {
    const files = [...list];
    // A .txt or .md file is read here and sent as text, the way a paste is.
    if (files.length === 1 && isPlainText(files[0])) {
      const [file] = files;
      await run("text", file.name, async () => {
        const text = await file.text();
        if (text.trim().length === 0) throw new ImportProblem("That file is empty.");
        if (text.length > MAX_TEXT_CHARS) {
          throw new ImportProblem(
            `That file is ${text.length.toLocaleString("en-US")} characters, and Spotter reads up to ${MAX_TEXT_CHARS.toLocaleString("en-US")}. Paste just the part you need.`,
          );
        }
        const form = new FormData();
        form.set("format", "text");
        form.set("text", text);
        return { form, bytes: text.length };
      });
      return;
    }
    let format: Exclude<ImportFormat, "text">;
    try {
      format = detectFormat(files);
    } catch (problem) {
      setError({ message: problem instanceof ImportProblem ? problem.message : "Could not read that file.", code: null });
      return;
    }

    await run(format, files.map((file) => file.name).join(", "), async () => {
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
      const { text, notes } = await readTable(files[0], format);
      form.set("text", text);
      return { form, bytes: text.length, notes };
    });
  }

  async function importPasted() {
    await run("text", "Pasted text", async () => {
      const problem = pastedTextProblem(pasted, noun);
      if (problem) throw new ImportProblem(problem);
      const form = new FormData();
      form.set("format", "text");
      form.set("text", pasted);
      return { form, bytes: pasted.length };
    });
  }

  const pasteId = `${kind}-paste`;
  const drop = {
    onDragOver: (event: React.DragEvent) => {
      if (disabled) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (!disabled && event.dataTransfer.files.length > 0) void importFiles(event.dataTransfer.files);
    },
  };

  const status = (
    <>
      {busy && <p className="px-3 py-1 font-semibold text-ink">{busy}</p>}
      {error && (
        <p role="alert" className="flex items-center gap-2 px-3 py-1 text-red" title={error.code ? `Error code: ${error.code}` : undefined}>
          <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
          {error.message}
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="flex items-center gap-2 px-3 py-1">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-dot" />
          {warning}
        </p>
      ))}
    </>
  );

  // Asked once per account, before the first import (audit M5). Shown only
  // when an import is otherwise possible.
  const consent = !terms.accepted && blockedBy === null && (
    <label className="flex items-start gap-2 px-3 py-2 text-[13px] text-ink">
      <input
        type="checkbox"
        className="mt-[3px] h-4 w-4 shrink-0 accent-accent"
        onChange={(event) => {
          if (event.target.checked) void terms.accept();
        }}
      />
      <span>
        I have the right to use this roster or stats sheet for my broadcast, and I agree to the{" "}
        <a href="/terms" target="_blank" rel="noopener" className="text-accent hover:underline">
          Terms
        </a>
        .
      </span>
    </label>
  );

  const picker_ = (
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
  );

  if (!open) {
    return (
      <section>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={false}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          {...drop}
          className={`flex min-h-[64px] cursor-pointer items-center gap-3 rounded-[3px] border border-dashed px-4 text-[15px] transition-colors duration-100 hover:bg-surface-2 ${
            dragging ? "border-ink bg-surface-2" : "border-line-strong"
          }`}
        >
          <span className="text-[17px] font-semibold">Import</span>
          <span className="min-w-0 truncate text-muted">{barHint}</span>
        </div>
        {blockedBy && <p className="px-3 py-1 text-amber-text">{blockedBy}</p>}
        {consent}
        {status}
      </section>
    );
  }

  return (
    <section className="rounded-[3px] border border-dashed border-line-strong">
      <div className="flex min-h-11 items-center gap-2 border-b border-dashed border-line-strong px-4">
        <p className="text-[17px] font-semibold text-ink">{title}</p>
        {layout === "bar" && (
          <Button className="ml-auto my-1" onClick={() => setOpen(false)}>
            Close
          </Button>
        )}
      </div>
      {blockedBy && <p className="px-3 pt-2 text-amber-text">{blockedBy}</p>}
      {consent}

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[3fr_2fr]">
        <div
          {...drop}
          className={`flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-[3px] border border-dashed px-6 py-8 text-center ${
            dragging ? "border-ink bg-surface-2" : "border-line-strong"
          } ${disabled ? "text-disabled" : ""}`}
        >
          <p className="text-[20px] font-semibold">Drop the {noun} here</p>
          <p className="max-w-[460px] text-[15px] text-muted">
            A PDF, up to {MAX_IMAGES} screenshots or photos, or a CSV or Excel file.
          </p>
          <Button className="h-11 px-6 text-[15px]" disabled={disabled} onClick={() => picker.current?.click()}>
            Choose files
          </Button>
          {picker_}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={pasteId} className={LABEL}>
            Or paste the {noun}
          </label>
          <textarea
            id={pasteId}
            disabled={disabled}
            rows={10}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder={pastePlaceholder}
            className="min-h-[220px] w-full flex-1 rounded-[3px] border border-line-strong bg-surface p-2 text-[13px] text-ink placeholder:text-disabled disabled:border-line disabled:text-disabled"
          />
          <Button className="self-start" disabled={disabled || pasted.trim().length === 0} onClick={() => void importPasted()}>
            Import pasted text
          </Button>
        </div>
      </div>
      {status}
    </section>
  );
}
