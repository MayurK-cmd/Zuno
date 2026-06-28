/**
 * `UsernameDialog` — asks the user to pick a display name the moment
 * their wallet finishes connecting. The name is stored in localStorage
 * so the lobby / game can show "Greetings, alice" without needing the
 * indexer.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "zuno:username";

export function getStoredUsername(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

function storeUsername(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, name);
}

interface UsernameDialogProps {
  /** When the wallet is connected and we still don't have a username. */
  open: boolean;
  /** Fires once the user has saved a valid name. */
  onSaved: (name: string) => void;
}

export function UsernameDialog({ open, onSaved }: UsernameDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(getStoredUsername() ?? "");
      setError(null);
    }
  }, [open]);

  const trimmed = name.trim();
  const valid = trimmed.length >= 2 && trimmed.length <= 20 && /^[A-Za-z0-9_ -]+$/.test(trimmed);

  const save = () => {
    if (!valid) {
      setError("2-20 chars, letters/numbers/space/underscore/dash only");
      return;
    }
    storeUsername(trimmed);
    onSaved(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={() => undefined /* modal — only the button closes it */}>
      <DialogContent className="glass-strong border-white/10 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Welcome to Zuno</DialogTitle>
          <DialogDescription>
            Pick a display name other players will see at the table.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="zuno-username">
            Display name
          </label>
          <Input
            id="zuno-username"
            autoFocus
            placeholder="e.g. StellarKnight"
            value={name}
            maxLength={20}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
          {error && <div className="text-xs text-danger">{error}</div>}
          <div className="text-[10px] text-muted-foreground">
            2-20 characters. Letters, numbers, spaces, underscores, dashes.
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!valid} className="w-full">
            Save and continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}