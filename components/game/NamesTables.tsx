import type { LoadedGame } from "@/lib/game/buildGame";
import { TABLE, TableBox, TD, TD_NUM, TH, TH_NUM, TR } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/Rows";
import { PANEL_HEADING } from "@/components/ui/Panel";

type Assembled = Pick<LoadedGame, "home" | "away" | "watchlist" | "collisions" | "teamSounds" | "similarJerseys"> &
  Partial<Pick<LoadedGame, "firstNames">>;

/** Who wears a watchlist entry: the schools and the jerseys, from its cards. */
function wearers(entry: Assembled["watchlist"]["entries"][number], game: Assembled): { teams: string; jerseys: string } {
  const players = entry.players ?? [];
  // Away first, the way the matchup reads.
  const sides = (["A", "H"] as const).filter((side) => players.some((player) => player.side === side));
  return {
    teams: sides.map((side) => (side === "H" ? game.home.school : game.away.school)).join(", "),
    jerseys: players
      .map((player) => player.jersey)
      .filter((jersey): jersey is string => Boolean(jersey))
      .join(", "),
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className={PANEL_HEADING}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Every name list game setup used to print inline, as plain tables
 * (docs/UI_STYLE.md, A7), built from the same assembled game Start builds.
 */
export function NamesTables({ game }: { game: Assembled }) {
  const entries = [...game.watchlist.entries].sort((a, b) =>
    (a.label || a.name).localeCompare(b.label || b.name, undefined, { sensitivity: "base" }),
  );
  return (
    <div className="flex flex-col gap-6">
      <Section title="Every name Spotter listens for">
        <TableBox>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Label</th>
                <th className={TH}>Team</th>
                <th className={TH_NUM}>#</th>
                <th className={TH}>Exact only</th>
                <th className={TH}>Extra forms</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const who = wearers(entry, game);
                return (
                  <tr key={entry.name} className={TR}>
                    <td className={`${TD} font-num text-[12px] font-semibold`}>{entry.label || entry.name}</td>
                    <td className={TD}>{who.teams}</td>
                    <td className={TD_NUM}>{who.jerseys}</td>
                    <td className={TD}>{entry.exactOnly ? "Exact only" : ""}</td>
                    <td className={`${TD} text-muted`}>{entry.aliases.join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableBox>
      </Section>

      <Section title="Names that sound alike">
        {game.collisions.length === 0 ? (
          <EmptyState className="px-0">No two names in this game sound alike.</EmptyState>
        ) : (
          <>
            <TableBox>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Name</th>
                    <th className={TH}>Sounds like</th>
                    <th className={TH}>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {game.collisions.map((collision) => (
                    <tr key={`${collision.a}-${collision.b}`} className={TR}>
                      <td className={`${TD} font-semibold`}>{collision.a}</td>
                      <td className={`${TD} font-semibold`}>{collision.b}</td>
                      <td className={TD}>
                        {collision.a} and {collision.b} can be heard as each other.
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBox>
            <p className="text-muted">
              Either name puts both cards up; saying the number as well narrows it to one. A pronunciation note, or
              exact-only spotting for one of them, on the team page can help.
            </p>
          </>
        )}
      </Section>

      {(game.firstNames ?? []).length > 0 && (
        <Section title="First names that are surnames">
          <p className="text-muted">
            Spotter listens for surnames, and these first names sound like one on the other side or the same side. Saying
            the first name can put that other card up.
          </p>
          <TableBox>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>First name</th>
                  <th className={TH}>Player</th>
                  <th className={TH}>Also the surname of</th>
                  <th className={TH}>Tonight</th>
                </tr>
              </thead>
              <tbody>
                {(game.firstNames ?? []).map((hit) => (
                  <tr key={`${hit.player}-${hit.surname}`} className={TR}>
                    <td className={`${TD} font-semibold`}>{hit.first}</td>
                    <td className={TD}>{hit.player}</td>
                    <td className={TD}>
                      {hit.surname}
                      {hit.jersey ? ` #${hit.jersey}` : ""}
                      {hit.side ? ` (${hit.side === "H" ? game.home.school : game.away.school})` : ""}
                    </td>
                    <td className={hit.verdict === "would_fire" ? `${TD} font-semibold text-amber-text` : TD}>
                      {hit.verdict === "would_fire" ? "Is heard as it" : "Sounds close"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
        </Section>
      )}

      {game.teamSounds.length > 0 && (
        <Section title="Names that sound like a team">
          <p className="text-muted">
            Both schools and mascots are said all game. These names can go up when a team is named. Consider a
            pronunciation note or exact-only spotting for them on the team page.
          </p>
          <TableBox>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Name</th>
                  <th className={TH}>Sounds like</th>
                  <th className={TH}>Tonight</th>
                </tr>
              </thead>
              <tbody>
                {game.teamSounds.map((warning) => (
                  <tr key={warning.name} className={TR}>
                    <td className={`${TD} font-semibold`}>{warning.name}</td>
                    <td className={TD}>{warning.hits.map((hit) => `"${hit.word}"`).join(", ")}</td>
                    <td className={warning.verdict === "would_fire" ? `${TD} font-semibold text-amber-text` : TD}>
                      {warning.verdict === "would_fire" ? "Goes up" : "Comes close"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
        </Section>
      )}

      {game.similarJerseys.length > 0 && (
        <Section title="Numbers that sound alike">
          <TableBox>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH_NUM}>#</th>
                  <th className={TH}>Player</th>
                  <th className={TH_NUM}>Sounds like #</th>
                  <th className={TH}>Player</th>
                </tr>
              </thead>
              <tbody>
                {game.similarJerseys.map((pair) => (
                  <tr key={`${pair.a.side}${pair.a.jersey}-${pair.b.side}${pair.b.jersey}`} className={TR}>
                    <td className={TD_NUM}>{pair.a.jersey}</td>
                    <td className={TD}>{pair.a.name}</td>
                    <td className={TD_NUM}>{pair.b.jersey}</td>
                    <td className={TD}>{pair.b.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
          <p className="text-muted">Spotter shows both cards when it hears either number.</p>
        </Section>
      )}

      {game.watchlist.droppedParts.length > 0 && (
        <Section title="Dropped name parts">
          <TableBox>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Player</th>
                  <th className={TH}>Will not answer to</th>
                  <th className={TH}>Because</th>
                </tr>
              </thead>
              <tbody>
                {game.watchlist.droppedParts.map((part) => (
                  <tr key={`${part.from}-${part.part}`} className={TR}>
                    <td className={`${TD} font-semibold`}>{part.from}</td>
                    <td className={TD}>&quot;{part.part}&quot;</td>
                    <td className={TD}>{part.collidesWith} is another player in this game.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
        </Section>
      )}
    </div>
  );
}
