import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Sparkles,
  Rocket,
  Lock,
  Zap,
  Github,
  MessageCircle,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import { Starfield } from "@/components/Starfield";
import { Header } from "@/components/Header";
import { useWallet } from "@/hooks/use-wallet";
import { UnoCard } from "@/components/UnoCard";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Zuno — Zero-Knowledge Uno on Stellar" },
      {
        name: "description",
        content:
          "Play Uno on Stellar with cryptographic proof your hand is real. Cosmic, trustless, private gameplay.",
      },
      { property: "og:title", content: "Zuno — Zero-Knowledge Uno on Stellar" },
      {
        property: "og:description",
        content: "High-stakes ZK card game powered by Stellar.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { publicKey, isInstalled, connect } = useWallet();
  const navigate = useNavigate();

  const handleConnect = async () => {
    if (!isInstalled) {
      toast.error("Freighter not installed", {
        description: "Install Freighter from freighter.app and reload to play Zuno.",
      });
      return;
    }
    await connect();
    if (publicKey) {
      toast.success("Wallet connected", { description: "Welcome to Zuno" });
      setTimeout(() => navigate({ to: "/lobby" }), 400);
    }
  };

  return (
    <div className="relative min-h-screen">
      <Starfield />
      <Header />

      <main className="mx-auto max-w-7xl px-4 pb-24">
        {/* Hero */}
        <section className="relative grid gap-12 pt-12 md:grid-cols-[1.2fr_1fr] md:pt-20">
          <div className="flex flex-col justify-center">
            <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 glass">
              <span className="h-1.5 w-1.5 rounded-full bg-neon animate-pulse-glow" />
              <span className="text-xs text-muted-foreground">Live on Stellar Testnet</span>
            </div>
            <h1 className="font-display text-6xl font-black leading-[0.95] tracking-tighter md:text-8xl">
              <span className="text-gradient-stellar drop-shadow-[0_0_40px_oklch(0.78_0.16_220/0.4)]">
                ZUNO
              </span>
            </h1>
            <p className="mt-4 font-mono text-base text-muted-foreground md:text-lg">
              Zero-Knowledge Uno on Stellar
            </p>
            <p className="mt-6 max-w-xl text-base text-foreground/80 md:text-lg">
              The classic card game, reimagined for crypto. Every move proven on-chain, every hand
              kept private. Play for XLM, settle in seconds.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {publicKey ? (
                <Link
                  to="/lobby"
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-stellar to-crypto px-6 py-3 text-sm font-semibold text-primary-foreground glow-stellar hover:scale-[1.03] transition"
                >
                  <Rocket className="h-4 w-4" /> Enter Lobby
                </Link>
              ) : (
                <button
                  onClick={handleConnect}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-stellar to-crypto px-6 py-3 text-sm font-semibold text-primary-foreground glow-stellar hover:scale-[1.03] transition"
                >
                  <Sparkles className="h-4 w-4" /> Connect Wallet
                </button>
              )}
              <Link
                to="/about"
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium glass hover:glass-strong transition"
              >
                Learn More
              </Link>
            </div>
          </div>

          {/* Card fan visual */}
          <div className="relative grid place-items-center">
            <div className="absolute h-72 w-72 rounded-full bg-gradient-to-br from-stellar/30 to-crypto/30 blur-3xl" />
            <div className="relative flex items-end justify-center">
              <div className="-mr-8 rotate-[-14deg]">
                <UnoCard card={{ id: "1", color: "red", value: 7 }} size="lg" />
              </div>
              <div className="-mr-8 rotate-[-4deg] -translate-y-3">
                <UnoCard card={{ id: "2", color: "blue", value: "+2" }} size="lg" />
              </div>
              <div className="-mr-8 rotate-[6deg] -translate-y-1">
                <UnoCard card={{ id: "3", color: "wild", value: "wild" }} size="lg" />
              </div>
              <div className="rotate-[16deg]">
                <UnoCard card={{ id: "4", color: "green", value: 4 }} size="lg" />
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mt-24 grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Rocket,
              title: "On-Chain Proofs",
              body: "Play with cryptographic proof your hand is real. No trust, no cheating.",
              glow: "glow-stellar",
              color: "text-stellar",
            },
            {
              icon: Zap,
              title: "Stellar Powered",
              body: "Fast, cheap, trustless gameplay settled in seconds on Stellar.",
              glow: "glow-gold",
              color: "text-gold",
            },
            {
              icon: Lock,
              title: "Private Hands",
              body: "Your cards never leave your browser. Zero-knowledge keeps them yours.",
              glow: "glow-crypto",
              color: "text-crypto",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="group relative overflow-hidden rounded-2xl p-6 glass transition hover:-translate-y-1 hover:glass-strong"
            >
              <div
                className={`mb-4 grid h-12 w-12 place-items-center rounded-xl glass-strong ${f.color} group-hover:${f.glow} transition`}
              >
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-display text-xl font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 md:flex-row">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-stellar" />
            <span>Zuno · Built on Stellar</span>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
            <a
              href="#"
              className="inline-flex items-center gap-1.5 hover:text-foreground transition"
            >
              <BookOpen className="h-3.5 w-3.5" /> Docs
            </a>
            <a
              href="#"
              className="inline-flex items-center gap-1.5 hover:text-foreground transition"
            >
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
            <a
              href="#"
              className="inline-flex items-center gap-1.5 hover:text-foreground transition"
            >
              <MessageCircle className="h-3.5 w-3.5" /> Discord
            </a>
            <a
              href="https://stellar.expert"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-foreground transition"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Stellar Expert
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
