import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Track } from './src/data/tracks';
import HomeScreen from './src/screens/HomeScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import PaywallScreen from './src/screens/PaywallScreen';

type Screen = { name: 'home' } | { name: 'player'; track: Track } | { name: 'paywall' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [isPremium, setIsPremium] = useState(false);

  return (
    <>
      {screen.name === 'home' && (
        <HomeScreen
          isPremium={isPremium}
          onSelectTrack={(track) => setScreen({ name: 'player', track })}
          onOpenPaywall={() => setScreen({ name: 'paywall' })}
        />
      )}
      {screen.name === 'player' && (
        <PlayerScreen track={screen.track} onBack={() => setScreen({ name: 'home' })} />
      )}
      {screen.name === 'paywall' && (
        <PaywallScreen
          onClose={() => setScreen({ name: 'home' })}
          onMockPurchase={() => {
            setIsPremium(true);
            setScreen({ name: 'home' });
          }}
        />
      )}
      <StatusBar style="light" />
    </>
  );
}
