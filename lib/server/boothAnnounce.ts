import { membersOnline, publish } from "./boothBus";
import { boothSlots } from "./repo/booth";

// Booth partners (Nov 15): tells every laptop in a booth who is in it now,
// after someone joined, left or was taken out. Slots and online flags only.
export async function announceMembers(gameId: string): Promise<void> {
  try {
    publish(gameId, { type: "members", members: membersOnline(gameId, await boothSlots(gameId)) });
  } catch {
    // The next connection's hello says it instead.
  }
}
