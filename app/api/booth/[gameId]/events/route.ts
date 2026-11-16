import type { BoothMessage } from "@/lib/booth/wire";
import { announceMembers } from "@/lib/server/boothAnnounce";
import { membersOnline, subscribe } from "@/lib/server/boothBus";
import { requireUser } from "@/lib/server/auth";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { boothRole, boothSlots } from "@/lib/server/repo/booth";
import { notFound, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ gameId: string }> };

export const dynamic = "force-dynamic";

// =============================================================================
// GET: the booth's live connection (Nov 15), as server-sent events. One per
// laptop while a booth game is open. A route handler cannot take a WebSocket
// (the token route says why), and the laptops only ever need to hear, so a
// stream down and a POST up (cards/route.ts) is the whole relay.
//
// Only the host or an active guest of a draft or live game; anyone else, and
// an ended game, is a 404, which the browser reads as "the booth is over".
// =============================================================================

/** A comment line this often, so no proxy (Cloudflare cuts an idle one at 100 s) takes the stream for dead. */
const HEARTBEAT_MS = 20_000;
/** The stream ends itself after this, and the browser opens a fresh one: nothing stays open for a day by mistake. */
const MAX_OPEN_MS = 10 * 60_000;

export async function GET(request: Request, { params }: Context) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { gameId } = await params;
  if (!UUID.test(gameId)) return notFound();
  if (!takeToken("boothConnectUser", gate.user.id)) return tooManyRequests();
  const role = await boothRole(gate.user.id, gameId);
  if (!role) return notFound();
  const slots = await boothSlots(gameId);

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      const send = (message: BoothMessage) => {
        write(`data: ${JSON.stringify(message)}\n\n`);
        // The game is over, or this guest is out: nothing more to hear.
        if (message.type === "ended" || message.type === "removed") close();
      };
      const unsubscribe = subscribe(gameId, role.slot, send);
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
      const lifetime = setTimeout(() => close(), MAX_OPEN_MS);
      function close() {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // Already closed by the browser.
        }
        void announceMembers(gameId);
      }
      cleanup = close;
      request.signal.addEventListener("abort", close);
      // How soon the browser's EventSource tries again on its own; lib/booth/link.ts has its own backoff too.
      write("retry: 2000\n\n");
      send({ type: "hello", you: role.slot, members: membersOnline(gameId, slots) });
      void announceMembers(gameId);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: next start's compression leaves the stream alone, so every event goes out as it is written.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
