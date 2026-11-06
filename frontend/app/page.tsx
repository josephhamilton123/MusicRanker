import { Suspense } from "react";
import { TrackRankApp } from "@/components/TrackRankApp";

export default function Home() {
  return (
    <Suspense fallback={<p className="px-6 py-10 text-sm text-zinc-500">Loading library…</p>}>
      <TrackRankApp />
    </Suspense>
  );
}
