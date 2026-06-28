import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Lock, Rocket, Zap } from "lucide-react";
import { Starfield } from "@/components/Starfield";
import { Header } from "@/components/Header";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "How to Play — Zuno" },
      { name: "description", content: "Learn how to play Zuno: zero-knowledge Uno on Stellar." },
    ],
  }),
  component: About,
});

function About() {
  return (
    <div className="relative min-h-screen">
      <Starfield />
      <Header />
      <main className="mx-auto max-w-3xl px-4 pb-24">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs glass hover:glass-strong transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>

        <h1 className="mt-6 font-display text-4xl font-black md:text-5xl">
          How to play <span className="text-gradient-stellar">Zuno</span>
        </h1>
        <p className="mt-3 text-muted-foreground">
          Zuno is classic Uno reimagined as a trustless, on-chain card game. Every move you make is
          backed by a zero-knowledge proof so opponents can verify your play without ever seeing
          your hand.
        </p>

        <div className="mt-10 space-y-4">
          {[
            {
              icon: Rocket,
              title: "1. Connect & stake",
              body: "Connect your Stellar wallet, set a stake in XLM, and create or join a room.",
            },
            {
              icon: Zap,
              title: "2. Play your turn",
              body: "Match the top card by color or number. Action cards (Skip, Reverse, +2) and wild cards work just like classic Uno.",
            },
            {
              icon: Lock,
              title: "3. Prove every move",
              body: "Each play generates a ZK proof in your browser. The proof verifies on Stellar — your hand stays private.",
            },
          ].map((s) => (
            <div key={s.title} className="flex gap-4 rounded-2xl p-5 glass">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-stellar/15 text-stellar">
                <s.icon className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-display text-base font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl p-5 glass-strong">
          <h3 className="font-display text-lg font-semibold">Don't forget to call ZUNO!</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            When you have one card left, hit the ZUNO! button. Miss it and you draw a penalty.
          </p>
        </div>

        <Link
          to="/lobby"
          className="mt-10 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-stellar to-crypto px-6 py-3 text-sm font-semibold text-primary-foreground glow-stellar"
        >
          Enter the lobby
        </Link>
      </main>
    </div>
  );
}
