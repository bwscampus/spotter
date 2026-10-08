import { redirect } from "next/navigation";
import { namesHref, readSetupPicks, type SearchParams } from "@/lib/game/setupReturn";

type DetailsProps = { searchParams: Promise<SearchParams> };

/** The names page's old address (Oct 4). It lives under setup now, at /games/new/names. */
export default async function Details({ searchParams }: DetailsProps) {
  redirect(namesHref(readSetupPicks(await searchParams)));
}
