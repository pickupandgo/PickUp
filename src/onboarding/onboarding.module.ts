import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import {
  AdminOnboardingController,
  InternalEligibilityController,
} from './admin-onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { DocumentStorageService } from './document-storage.service';
import { GuardDutyScanController } from './guardduty-scan.controller';
import { GuardDutyScanService } from './guardduty-scan.service';
@Module({
  controllers: [
    OnboardingController,
    AdminOnboardingController,
    InternalEligibilityController,
    GuardDutyScanController,
  ],
  providers: [OnboardingService, DocumentStorageService, GuardDutyScanService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
