import { PageBody, Toolbar, type Crumb } from "@/components/ui/Toolbar";

/**
 * What a team page shows when its read failed (M12): the reason and nothing
 * else. No editor and no empty table, because Save on an empty roster would
 * write that emptiness over the saved players.
 */
export function LoadError({ title, message, crumbs = [] }: { title: string; message: string; crumbs?: Crumb[] }) {
  return (
    <>
      <Toolbar crumbs={crumbs} title={title} />
      <PageBody>
        <p role="alert" className="flex items-center gap-2 font-semibold text-red">
          <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
          {message}
        </p>
      </PageBody>
    </>
  );
}
