'use client'

import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Crown, LogOut, Plus, ShieldCheck, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { truncateAddress } from '@/lib/solana'
import { WalletBalanceBadge } from './wallet-balance-badge'

interface RoomLobbyProps {
  playerName: string
  onJoinRoom: (roomId: string) => void
  onDisconnect: () => void
}

interface Room {
  id: string
  name: string
  host: string
  players: number
  maxPlayers: number
  buyIn: number
  status: 'waiting' | 'playing'
}

const MOCK_ROOMS: Room[] = [
  {
    id: 'room-001',
    name: 'Casual Game',
    host: 'Alice',
    players: 2,
    maxPlayers: 4,
    buyIn: 0.1,
    status: 'waiting',
  },
  {
    id: 'room-002',
    name: 'High Stakes',
    host: 'Bob',
    players: 3,
    maxPlayers: 4,
    buyIn: 1.0,
    status: 'playing',
  },
  {
    id: 'room-003',
    name: 'Friends Night',
    host: 'Charlie',
    players: 1,
    maxPlayers: 4,
    buyIn: 0.5,
    status: 'waiting',
  },
]

export function RoomLobby({
  playerName,
  onJoinRoom,
  onDisconnect,
}: RoomLobbyProps) {
  const { publicKey } = useWallet()
  const [rooms, setRooms] = useState<Room[]>(MOCK_ROOMS)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomBuyIn, setNewRoomBuyIn] = useState('0.1')

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRoomName.trim()) return

    const newRoom: Room = {
      id: `room-${Date.now()}`,
      name: newRoomName,
      host: playerName,
      players: 1,
      maxPlayers: 4,
      buyIn: parseFloat(newRoomBuyIn),
      status: 'waiting',
    }

    setRooms((currentRooms) => [newRoom, ...currentRooms])
    setNewRoomName('')
    setNewRoomBuyIn('0.1')
    setShowCreateForm(false)
    onJoinRoom(newRoom.id)
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-b border-cyan-500/20 bg-gradient-to-r from-slate-900/80 to-slate-800/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-cyan-400 to-green-400 bg-clip-text text-3xl font-black text-transparent">
              ZUNO Rooms
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              Playing as{' '}
              <span className="font-semibold text-cyan-300">{playerName}</span>
              {publicKey && (
                <span className="ml-2 font-mono text-xs text-slate-400">
                  {truncateAddress(publicKey)}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <WalletBalanceBadge />
            <WalletMultiButton className="zuno-wallet-button min-h-10 rounded-lg border border-cyan-500/30 bg-slate-900/80 px-3 text-sm font-semibold text-cyan-100" />
            <Button
              type="button"
              onClick={onDisconnect}
              className="min-h-10 rounded-lg bg-slate-700 px-4 py-2 text-white hover:bg-red-600/80"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Leave
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="mb-6 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
            <div className="flex items-start gap-3">
              <ShieldCheck
                className="mt-0.5 size-5 shrink-0 text-cyan-300"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold">Host migration is armed.</p>
                <p className="mt-1 text-cyan-100/80">
                  If a host leaves the lobby, ownership automatically moves to
                  the next seated player so table funds never get stuck.
                </p>
              </div>
            </div>
          </div>

          {!showCreateForm ? (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="mb-8 flex min-h-24 w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed border-cyan-500/30 p-6 text-cyan-300 hover:border-cyan-300 hover:bg-cyan-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              <Plus className="size-6" aria-hidden="true" />
              <span className="text-lg font-semibold">Create New Room</span>
            </button>
          ) : (
            <div className="mb-8 rounded-xl border border-cyan-500/20 bg-gradient-to-b from-slate-800/50 to-slate-900/50 p-6 backdrop-blur-xl">
              <h3 className="mb-4 text-xl font-bold text-white">
                Create a New Room
              </h3>
              <form onSubmit={handleCreateRoom} className="space-y-4">
                <div>
                  <label
                    htmlFor="room-name"
                    className="mb-2 block text-sm text-slate-300"
                  >
                    Room Name
                  </label>
                  <input
                    id="room-name"
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder="e.g., Casual Game Night"
                    autoComplete="off"
                    className="min-h-11 w-full rounded-lg border border-cyan-500/30 bg-slate-900/80 px-4 py-2 text-white placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                  />
                </div>
                <div>
                  <label
                    htmlFor="room-buy-in"
                    className="mb-2 block text-sm text-slate-300"
                  >
                    Buy-in (SOL)
                  </label>
                  <select
                    id="room-buy-in"
                    value={newRoomBuyIn}
                    onChange={(e) => setNewRoomBuyIn(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-cyan-500/30 bg-slate-900/80 px-4 py-2 text-white focus-visible:border-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                  >
                    <option value="0">Free Play</option>
                    <option value="0.1">0.1 SOL</option>
                    <option value="0.5">0.5 SOL</option>
                    <option value="1.0">1.0 SOL</option>
                    <option value="5.0">5.0 SOL</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="min-h-11 flex-1 rounded-lg bg-gradient-to-r from-cyan-500 to-green-500 py-2 font-bold text-black hover:from-cyan-400 hover:to-green-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  >
                    Create Room
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="min-h-11 flex-1 rounded-lg bg-slate-700 py-2 font-bold text-white hover:bg-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          <div>
            <h2 className="mb-4 text-xl font-bold text-white">
              Available Rooms
            </h2>
            {rooms.length === 0 ? (
              <div className="rounded-xl border border-cyan-500/20 bg-slate-900/70 p-8 text-center">
                <Crown
                  className="mx-auto mb-3 size-10 text-cyan-300"
                  aria-hidden="true"
                />
                <p className="font-semibold text-white">No rooms yet</p>
                <p className="mt-1 text-sm text-slate-300">
                  Create the first table and you will become the host.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-slate-800/50 to-slate-900/50 p-6 backdrop-blur-xl hover:border-cyan-400/50 hover:bg-slate-800/70"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-white">
                          {room.name}
                        </h3>
                        <p className="text-sm text-slate-300">
                          Host: {room.host}
                        </p>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          room.status === 'waiting'
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-yellow-500/20 text-yellow-300'
                        }`}
                      >
                        {room.status === 'waiting' ? 'Waiting' : 'Playing'}
                      </div>
                    </div>

                    <div className="mb-4 space-y-3">
                      <div className="flex items-center gap-2 text-slate-200">
                        <Users className="size-4" aria-hidden="true" />
                        <span className="text-sm">
                          {room.players}/{room.maxPlayers} Players
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono font-semibold tabular-nums text-yellow-300">
                          {room.buyIn} SOL
                        </span>
                        <span className="text-xs text-slate-400">buy-in</span>
                      </div>
                      <div className="rounded-lg border border-cyan-500/15 bg-slate-950/40 p-2 text-xs text-slate-300">
                        Host fallback: next seated player
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onJoinRoom(room.id)}
                      disabled={
                        room.players >= room.maxPlayers ||
                        room.status === 'playing'
                      }
                      className="min-h-11 w-full rounded-lg bg-gradient-to-r from-cyan-500 to-green-500 px-4 py-2 font-bold text-black hover:from-cyan-400 hover:to-green-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400"
                    >
                      {room.players >= room.maxPlayers
                        ? 'Room Full'
                        : room.status === 'playing'
                          ? 'In Progress'
                          : 'Join Room'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
