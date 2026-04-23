import type { PublicKey } from '@solana/web3.js'

export function truncateAddress(address: string | PublicKey, chars = 4) {
  const value = typeof address === 'string' ? address : address.toBase58()

  if (value.length <= chars * 2 + 3) {
    return value
  }

  return `${value.slice(0, chars)}...${value.slice(-chars)}`
}

export function formatSolAmount(amount: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: amount >= 1 ? 3 : 5,
    minimumFractionDigits: 0,
  }).format(amount)
}
