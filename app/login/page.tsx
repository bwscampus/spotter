import { redirect } from "next/navigation";
import { SignIn } from "@/components/auth/SignIn";
import { getViewer } from "@/lib/server/auth";

/** Sign-in is Google only (docs/technical-design.md section 4). */
export default async function Login() {
  const viewer = await getViewer();
  if (viewer.status === "approved" || viewer.status === "waiting") redirect("/");

  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-white px-6 text-black">
      <div className="mb-10 text-sm font-black tracking-[0.3em] text-neutral-400">SPOTTER</div>
      <SignIn />
    </div>
  );
}
