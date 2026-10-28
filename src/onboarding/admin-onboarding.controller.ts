import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { AdminOnly, CurrentPrincipal, InternalOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import {
  AdminReviewQuery,
  DocumentReviewRequest,
  DriverDecisionRequest,
  KycReviewRequest,
  KycVerifyRequest,
  VehicleReviewRequest,
} from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

enum DocumentKind {
  KYC = 'KYC',
  VEHICLE = 'VEHICLE',
}

@Controller({ path: 'admin/onboarding', version: '1' })
export class AdminOnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}
  @Get('drivers') @AdminOnly() queue(@Query() query: AdminReviewQuery) {
    return this.onboarding.adminReviewQueue(query.approvalStatus, query.limit);
  }
  @Get('drivers/:id') @AdminOnly() driver(@Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.adminDriverReview(id);
  }
  @Patch('kyc/:id/review') @AdminOnly() reviewKyc(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: KycReviewRequest,
  ) {
    return this.onboarding.reviewKyc(principal, id, body.decision, body.reason);
  }
  @Patch('kyc/:id/verify') @AdminOnly() verifyKyc(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: KycVerifyRequest,
  ) {
    return this.onboarding.verifyKyc(principal, id, body.reason, body.checklist, body.legalName);
  }
  @Patch('documents/:kind/:id/review') @AdminOnly() reviewDocument(
    @CurrentPrincipal() principal: Principal,
    @Param('kind', new ParseEnumPipe(DocumentKind)) kind: DocumentKind,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DocumentReviewRequest,
  ) {
    return this.onboarding.reviewDocument(principal, kind, id, body.decision, body.reason);
  }
  @Get('documents/:kind/:id/download') @AdminOnly() download(
    @CurrentPrincipal() principal: Principal,
    @Param('kind', new ParseEnumPipe(DocumentKind)) kind: DocumentKind,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.onboarding.adminDocumentDownload(principal, kind, id);
  }
  @Patch('vehicles/:id/review') @AdminOnly() reviewVehicle(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VehicleReviewRequest,
  ) {
    return this.onboarding.reviewVehicle(principal, id, body.decision, body.reason);
  }
  @Patch('drivers/:id/decision') @AdminOnly() decideDriver(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DriverDecisionRequest,
  ) {
    return this.onboarding.decideDriver(principal, id, body.decision, body.reason);
  }
}

@Controller({ path: 'internal/drivers', version: '1' })
export class InternalEligibilityController {
  constructor(private readonly onboarding: OnboardingService) {}
  @Get('by-subject/:subject/eligibility') @InternalOnly() eligibilityBySubject(
    @Param('subject') subject: string,
  ) {
    if (subject.length === 0 || subject.length > 128) {
      throw new BadRequestException('Invalid driver subject');
    }
    return this.onboarding.eligibilityForSubject(subject);
  }
  @Get(':driverId/eligibility') @InternalOnly() eligibility(
    @Param('driverId', ParseUUIDPipe) driverId: string,
  ) {
    return this.onboarding.eligibility(driverId);
  }
}
