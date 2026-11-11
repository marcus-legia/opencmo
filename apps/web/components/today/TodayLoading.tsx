import { Skeleton } from "@/components/clipping/Skeleton";

/**
 * What a Today-frame screen shows while its server part or its URL state is on the way (`app/app/loading.tsx`, the
 * pages' Suspense boundaries). The frame's top bar and chat stay; only the screen's column waits, padded like the
 * screens themselves. The classic page's library grid used to stand in here: a grid of video cards before Calendar or
 * Sales.
 */
export function TodayLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="td-loading" role="status" aria-label={label} aria-busy="true">
      <Skeleton width={220} height={26} />
      <Skeleton width="60%" height={14} />
      <Skeleton height={112} radius={12} />
      <Skeleton height={112} radius={12} />
      <Skeleton height={112} radius={12} />
    </div>
  );
}
