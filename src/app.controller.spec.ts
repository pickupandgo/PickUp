import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  const query = jest.fn();

  beforeEach(async () => {
    query.mockReset().mockResolvedValue([{ value: 1 }]);
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: { $queryRaw: query } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('checks database connectivity for readiness', async () => {
    await expect(appController.getReadiness()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails readiness without exposing database errors', async () => {
    query.mockRejectedValueOnce(new Error('private-connection-details'));
    await expect(appController.getReadiness()).rejects.toMatchObject({
      response: { status: 'error', database: 'unavailable' },
    });
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
