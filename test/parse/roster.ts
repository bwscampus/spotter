import { statsRoster } from "@/lib/livestats/roster";
import type { TeamWords } from "@/lib/livestats/types";

// Made-up names only (v7 non-negotiable 4): no roster file, no real player.
export const ROSTER = statsRoster(
  [
    { jersey: "7", first_name: "Dax", last_name: "Castellane", position: "QB" },
    { jersey: "22", first_name: "Reed", last_name: "Fennimore", position: "RB" },
    { jersey: "3", first_name: "Noa", last_name: "Tafita", position: "WR" },
    { jersey: "11", first_name: "Eli", last_name: "Brown", position: "WR" },
    { jersey: "55", first_name: "Tomas", last_name: "Okonkwo-Reyes", position: "OL" },
    { jersey: "88", first_name: "Cole", last_name: "Vantree", position: "TE" },
    { jersey: "40", first_name: "Ivo", last_name: "Pellegrosso", position: "FB" },
    { jersey: "1", first_name: "Max", last_name: "Whitlock", position: "K" },
  ],
  [
    { jersey: "17", first_name: "Marek", last_name: "Quillon", position: "LB" },
    { jersey: "4", first_name: "Jace", last_name: "Brown", position: "CB" },
    { jersey: "9", first_name: "Sam", last_name: "Langan", position: "QB" },
    { jersey: "32", first_name: "Theo", last_name: "Amesbury", position: "RB" },
    { jersey: "2", first_name: "Luis", last_name: "Duarte", position: "P" },
    { jersey: "81", first_name: "Kofi", last_name: "Ndiaye-Hall", position: "WR" },
    { jersey: "22", first_name: "Bo", last_name: "Grenville", position: "S" },
  ],
);

export const TEAMS: TeamWords = {
  home: { name: "Harborview", phrases: ["harborview", "sharks", "shark"] },
  away: { name: "Millbrook", phrases: ["millbrook", "bulldogs", "bulldog"] },
};
