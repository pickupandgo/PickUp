import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ENGINE_CONFIG, type EngineConfig } from './engine-config';

/** Provides the validated, immutable EngineConfig to every module under ENGINE_CONFIG. */
@Global()
@Module({})
export class EngineConfigModule {
  static register(config: EngineConfig): DynamicModule {
    return {
      module: EngineConfigModule,
      providers: [{ provide: ENGINE_CONFIG, useValue: config }],
      exports: [ENGINE_CONFIG],
    };
  }
}
