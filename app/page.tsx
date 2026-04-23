'use client';

import { useState } from 'react';
import { LandingScreen } from '@/components/zuno/landing-screen';
import { RoomLobby } from '@/components/zuno/room-lobby';
import { GameTable } from '@/components/zuno/game-table';

export default function Home() {
  const [gameState, setGameState] = useState<'landing' | 'lobby' | 'game'>('landing');
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');

  const handleSetName = (name: string) => {
    setPlayerName(name);
    setGameState('lobby');
  };

  const handleJoinRoom = (id: string) => {
    setRoomId(id);
    setGameState('game');
  };

  const handleBackToLobby = () => {
    setGameState('lobby');
    setRoomId('');
  };

  const handleDisconnect = () => {
    setGameState('landing');
    setPlayerName('');
    setRoomId('');
  };

  return (
    <div className="w-full h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black overflow-hidden">
      {gameState === 'landing' && <LandingScreen onStart={handleSetName} />}
      {gameState === 'lobby' && (
        <RoomLobby playerName={playerName} onJoinRoom={handleJoinRoom} onDisconnect={handleDisconnect} />
      )}
      {gameState === 'game' && (
        <GameTable playerName={playerName} roomId={roomId} onBack={handleBackToLobby} />
      )}
    </div>
  );
}
