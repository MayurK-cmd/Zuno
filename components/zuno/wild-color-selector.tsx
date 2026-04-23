'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { StandardColor } from './game-types'

const WILD_COLORS: Array<{
  color: StandardColor
  label: string
  className: string
}> = [
  {
    color: 'red',
    label: 'Declare red',
    className: 'bg-red-600 hover:bg-red-500 focus-visible:ring-red-200',
  },
  {
    color: 'blue',
    label: 'Declare blue',
    className: 'bg-blue-600 hover:bg-blue-500 focus-visible:ring-blue-200',
  },
  {
    color: 'green',
    label: 'Declare green',
    className: 'bg-green-600 hover:bg-green-500 focus-visible:ring-green-200',
  },
  {
    color: 'yellow',
    label: 'Declare yellow',
    className: 'bg-yellow-400 hover:bg-yellow-300 focus-visible:ring-yellow-100',
  },
]

export function WildColorSelector({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (color: StandardColor) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-cyan-500/30 bg-slate-950/95 text-white shadow-2xl shadow-cyan-500/10 backdrop-blur-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl">Choose wild color</DialogTitle>
          <DialogDescription className="text-slate-300">
            Game state is paused until a color is declared. The proof will be
            generated after this choice.
          </DialogDescription>
        </DialogHeader>
        <div className="mx-auto grid size-56 grid-cols-2 overflow-hidden rounded-full border-4 border-cyan-300/40 shadow-2xl shadow-cyan-500/20">
          {WILD_COLORS.map((wildColor) => (
            <button
              key={wildColor.color}
              type="button"
              onClick={() => onSelect(wildColor.color)}
              aria-label={wildColor.label}
              className={`${wildColor.className} flex items-center justify-center font-black text-black focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:hover:scale-105`}
            >
              <span className="sr-only">{wildColor.label}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
