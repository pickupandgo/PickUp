import { useEffect, useState } from 'react';
import { NativeLocationModule } from '../location/NativeLocationModule';

export function useConnectionHealth() {
  const [health, setHealth] = useState('DISCONNECTED');
  useEffect(() => {
    let alive = true;
    const update = () => NativeLocationModule.getConnectionHealth().then(value => {
      if (alive) setHealth(value);
    }).catch(() => { if (alive) setHealth('DISCONNECTED'); });
    update();
    const timer = setInterval(update, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return health;
}
