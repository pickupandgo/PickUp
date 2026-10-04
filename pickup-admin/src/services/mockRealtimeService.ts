import { simulateRealtimeTick, getCachedLiveData } from './liveTripService';
import { LiveOperationsData } from '@/types/live';

class MockRealtimeService {
  private intervalId: NodeJS.Timeout | null = null;
  private listeners: Array<(data: LiveOperationsData) => void> = [];
  public isRunning = false;

  startSimulation() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Simulate tick every 3 seconds
    this.intervalId = setInterval(() => {
      const newData = simulateRealtimeTick();
      if (newData) {
        this.notify(newData);
      }
    }, 3000);
  }

  stopSimulation() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  subscribe(callback: (data: LiveOperationsData) => void) {
    this.listeners.push(callback);
    // immediately send current cache if exists
    const current = getCachedLiveData();
    if (current) {
      callback(current);
    }
    
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  private notify(data: LiveOperationsData) {
    this.listeners.forEach(cb => cb(data));
  }
}

export const mockRealtimeService = new MockRealtimeService();
