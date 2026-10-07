import { getDocumentProxy } from "unpdf";

/**
 * Opens a PDF without destroying the caller's copy of it.
 *
 * getDocumentProxy hands the array straight to PDF.js, which takes ownership
 * and detaches the underlying ArrayBuffer. The caller's Uint8Array is left
 * with length 0, silently: nothing throws, and the bytes are simply gone.
 *
 * That matters because both upload routes need the file again after opening
 * it, to send to Claude. Without this copy the document reaches Anthropic as
 * an empty string and comes back as "PDF cannot be empty", which reads like a
 * problem with the upload rather than with this line.
 *
 * So PDF.js gets a copy and the caller keeps theirs.
 */
export async function openPdf(bytes: Uint8Array) {
  return getDocumentProxy(new Uint8Array(bytes));
}
