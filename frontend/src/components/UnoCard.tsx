import { cn } from "@/lib/utils";

export type CardColor = "red" | "blue" | "green" | "yellow" | "wild";
export type CardValue = number | "skip" | "reverse" | "+2" | "wild" | "+4";

export interface UnoCardData {
  id: string;
  color: CardColor;
  value: CardValue;
}

const colorClasses: Record<CardColor, string> = {
  red: "from-uno-red/90 to-uno-red/60 shadow-[0_0_28px_oklch(0.62_0.24_25/0.5)] ring-uno-red/60",
  blue: "from-uno-blue/90 to-uno-blue/60 shadow-[0_0_28px_oklch(0.7_0.18_235/0.5)] ring-uno-blue/60",
  green: "from-uno-green/90 to-uno-green/60 shadow-[0_0_28px_oklch(0.7_0.18_150/0.5)] ring-uno-green/60",
  yellow: "from-uno-yellow/90 to-uno-yellow/60 shadow-[0_0_28px_oklch(0.84_0.17_90/0.5)] ring-uno-yellow/60",
  wild: "from-uno-wild/90 via-crypto/80 to-uno-blue/60 shadow-[0_0_32px_oklch(0.7_0.22_305/0.6)] ring-uno-wild/70",
};

const labelFor = (v: CardValue) =>
  v === "skip" ? "⊘" : v === "reverse" ? "⇋" : v === "+2" ? "+2" : v === "+4" ? "+4" : v === "wild" ? "★" : String(v);

export function UnoCard({
  card,
  size = "md",
  selected,
  invalid,
  playable,
  onClick,
  className,
}: {
  card: UnoCardData;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  invalid?: boolean;
  playable?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const dims =
    size === "lg"
      ? "h-44 w-32 text-5xl"
      : size === "sm"
        ? "h-20 w-14 text-xl"
        : "h-32 w-22 text-3xl";
  const corner = size === "lg" ? "text-base" : size === "sm" ? "text-[10px]" : "text-xs";

  const label = labelFor(card.value);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={invalid}
      className={cn(
        "group relative shrink-0 select-none rounded-2xl border border-white/15 bg-gradient-to-br p-2 text-primary-foreground transition-all duration-200",
        dims,
        colorClasses[card.color],
        card.color === "wild" && "animate-rainbow-border border-2",
        onClick && "cursor-pointer hover:-translate-y-2 hover:scale-105",
        selected && "-translate-y-3 scale-105 ring-2 ring-stellar shadow-[0_0_36px_oklch(0.82_0.18_220/0.7)]",
        playable && !selected && "ring-2 ring-mint/70",
        invalid && "opacity-40 ring-2 ring-danger/70 cursor-not-allowed hover:translate-y-0 hover:scale-100",
        className,
      )}
      style={{ width: size === "md" ? "5.5rem" : undefined }}
    >
      <div className={cn("absolute left-2 top-1.5 font-mono font-bold", corner)}>{label}</div>
      <div className="grid h-full w-full place-items-center">
        <div className="relative grid h-[78%] w-[78%] place-items-center rounded-xl bg-white/15 backdrop-blur-sm font-display font-black drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
          {label}
        </div>
      </div>
      <div className={cn("absolute bottom-1.5 right-2 rotate-180 font-mono font-bold", corner)}>
        {label}
      </div>
    </button>
  );
}
