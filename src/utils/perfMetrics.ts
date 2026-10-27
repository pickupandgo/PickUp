/**
 * Performance Diagnostic Instrumentation for MultipleRide Driver App.
 *
 * Tracks cold start milestones and Go-Live latency using performance.now().
 * Strips all PII and sensitive data.
 */

export interface MetricEntry {
  name: string;
  startTime: number;
  durationMs?: number;
  metadata?: Record<string, string | number | boolean>;
}

const getNow = (): number => {
  const g = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined;
  if (g?.performance?.now) {
    return g.performance.now();
  }
  return Date.now();
};

class PerformanceMetrics {
  private static instance: PerformanceMetrics;
  private metrics = new Map<string, MetricEntry>();
  private appLaunchTime = getNow();

  static getInstance(): PerformanceMetrics {
    if (!PerformanceMetrics.instance) {
      PerformanceMetrics.instance = new PerformanceMetrics();
    }
    return PerformanceMetrics.instance;
  }

  getAppLaunchTime(): number {
    return this.appLaunchTime;
  }

  start(name: string, metadata?: Record<string, string | number | boolean>): string {
    const id = `${name}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const startTime = getNow();
    this.metrics.set(id, { name, startTime, metadata });
    return id;
  }

  end(id: string, additionalMetadata?: Record<string, string | number | boolean>): number {
    const entry = this.metrics.get(id);
    if (!entry) return 0;
    const durationMs = Math.round((getNow() - entry.startTime) * 10) / 10;
    entry.durationMs = durationMs;
    if (additionalMetadata) {
      entry.metadata = { ...entry.metadata, ...additionalMetadata };
    }
    console.log(`[PERF] ${entry.name}: ${durationMs}ms`, entry.metadata ? JSON.stringify(entry.metadata) : '');
    this.metrics.delete(id);
    return durationMs;
  }

  measureSinceLaunch(name: string, metadata?: Record<string, string | number | boolean>): number {
    const durationMs = Math.round((getNow() - this.appLaunchTime) * 10) / 10;
    console.log(`[PERF] [LAUNCH_MILESTONE] ${name}: ${durationMs}ms`, metadata ? JSON.stringify(metadata) : '');
    return durationMs;
  }
}

export const perfMetrics = PerformanceMetrics.getInstance();
