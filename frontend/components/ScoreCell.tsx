import { scoreClass } from "@/lib/score";

export function ScoreCell({ score, display }: { score: number | null; display: string }) {
  return (
    <span
      className={`flex h-9 w-full items-center justify-center rounded-[5px] px-2 text-[13px] font-semibold tabular-nums transition-colors ${scoreClass(score)}`}
    >
      {display}
    </span>
  );
}
