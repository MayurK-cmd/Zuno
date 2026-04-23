import type { CardColor, CardType } from './uno-card'

export interface GameCard {
  id: string
  color: CardColor
  type: CardType
  value?: number
  playable: boolean
}

export interface Player {
  id: string
  name: string
  cardCount: number
  isCurrentTurn: boolean
  hasCalledZuno: boolean
  drawsTaken: number
  position: 'left' | 'top' | 'right'
}

export interface GameOutcome {
  result: 'win' | 'loss'
  winner: string
  pot: number
  txHash: string
  turns: number
  mostDrawn: string
}

export type StandardColor = Exclude<CardColor, 'wild'>

export const TURN_LIMIT_SECONDS = 30

export const INITIAL_HAND: GameCard[] = [
  { id: '1', color: 'blue', type: 'number', value: 7, playable: true },
  { id: '2', color: 'wild', type: 'wild-draw', playable: true },
]

export const INITIAL_OPPONENTS: Player[] = [
  {
    id: '2',
    name: 'Alice',
    cardCount: 1,
    isCurrentTurn: false,
    hasCalledZuno: false,
    drawsTaken: 4,
    position: 'left',
  },
  {
    id: '3',
    name: 'Bob',
    cardCount: 6,
    isCurrentTurn: true,
    hasCalledZuno: true,
    drawsTaken: 7,
    position: 'right',
  },
]

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function fakeTxHash(seed: string) {
  return `Zuno${seed}${Math.random().toString(36).slice(2, 10)}9xQm7N`
}

export function describeCard(card: GameCard, declaredColor?: StandardColor) {
  if (card.type === 'number') {
    return `${card.color} ${card.value}`
  }

  if (card.type === 'wild' || card.type === 'wild-draw') {
    return declaredColor
      ? `${card.type === 'wild-draw' ? 'Wild +4' : 'Wild'} as ${declaredColor}`
      : card.type === 'wild-draw'
        ? 'Wild +4'
        : 'Wild'
  }

  if (card.type === 'draw') return `${card.color} +2`
  return `${card.color} ${card.type}`
}
