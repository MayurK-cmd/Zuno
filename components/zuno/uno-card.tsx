'use client'

import React from 'react'

export type CardColor = 'red' | 'blue' | 'green' | 'yellow' | 'wild'
export type CardType =
  | 'number'
  | 'skip'
  | 'reverse'
  | 'draw'
  | 'wild'
  | 'wild-draw'

interface UNOCardProps {
  color: CardColor
  type: CardType
  value?: number
  isSelected?: boolean
  isPlayable?: boolean
  onClick?: () => void
  className?: string
  size?: 'small' | 'medium' | 'large'
  backside?: boolean
}

const colorMap = {
  red: { bg: 'bg-red-600', border: 'border-red-700' },
  blue: { bg: 'bg-blue-600', border: 'border-blue-700' },
  green: { bg: 'bg-green-600', border: 'border-green-700' },
  yellow: { bg: 'bg-yellow-400', border: 'border-yellow-500' },
  wild: {
    bg: 'bg-gradient-to-br from-red-500 via-yellow-400 to-blue-500',
    border: 'border-yellow-300',
  },
}

const sizeMap = {
  small: 'h-24 w-16',
  medium: 'h-32 w-24',
  large: 'h-44 w-32',
}

function getSymbol(type: CardType, value?: number) {
  if (type === 'number' && value !== undefined) return value
  if (type === 'skip') return 'X'
  if (type === 'reverse') return 'R'
  if (type === 'draw') return '+2'
  if (type === 'wild') return '*'
  if (type === 'wild-draw') return '+4'
  return ''
}

export function UNOCard({
  color,
  type,
  value,
  isSelected = false,
  isPlayable = true,
  onClick,
  className = '',
  size = 'medium',
  backside = false,
}: UNOCardProps) {
  const colors = colorMap[color]
  const sizeClass = sizeMap[size]
  const symbol = getSymbol(type, value)
  const interactive = Boolean(onClick)

  const baseClassName = `${sizeClass} rounded-2xl border-4 ${colors.border} ${colors.bg} shadow-lg ${
    interactive ? 'cursor-pointer' : 'cursor-default'
  } p-1 flex flex-col items-center justify-between motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out ${
    interactive && isPlayable ? 'motion-safe:hover:scale-110 active:scale-95' : ''
  } ${
    isSelected ? 'ring-2 ring-cyan-300 -translate-y-8' : ''
  } ${
    !isPlayable ? 'cursor-not-allowed opacity-40' : ''
  } ${
    interactive
      ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950'
      : ''
  } ${className}`

  const content = backside ? (
    <div className="flex h-full w-full items-center justify-center text-white/30">
      <div className="text-4xl font-black">U</div>
    </div>
  ) : (
    <>
      <CornerSymbol symbol={symbol} size={size} />
      <div
        className={`font-black leading-none text-white ${
          size === 'small'
            ? 'text-xl'
            : size === 'medium'
              ? 'text-3xl'
              : 'text-5xl'
        }`}
      >
        {symbol}
      </div>
      <div className="rotate-180">
        <CornerSymbol symbol={symbol} size={size} />
      </div>
    </>
  )

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!isPlayable}
        className={baseClassName}
      >
        {content}
      </button>
    )
  }

  return <div className={baseClassName}>{content}</div>
}

function CornerSymbol({
  symbol,
  size,
}: {
  symbol: React.ReactNode
  size: 'small' | 'medium' | 'large'
}) {
  return (
    <div className="font-black leading-none text-white/80">
      <div
        className={`${
          size === 'small'
            ? 'text-xs'
            : size === 'medium'
              ? 'text-sm'
              : 'text-base'
        }`}
      >
        {symbol}
      </div>
    </div>
  )
}
