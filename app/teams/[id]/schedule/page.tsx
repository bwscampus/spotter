import { notFound, redirect } from "next/navigation";

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type TeamProps = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Schedule page's old address (Oct 28). Since Oct 29 a team's schedule is
 * imported and edited on the team page itself, under its Schedule box.
 */
export default async function TeamSchedule({ params }: TeamProps) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  redirect(`/teams/${id}`);
}
