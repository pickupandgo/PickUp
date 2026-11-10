import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from '../auth/decorators';
import { DeliveryProofsService } from './delivery-proofs.service';
import { InitiateProof, ProofBinding } from './delivery-proofs.dto';

@ApiExcludeController()
@InternalOnly()
@Controller({ path: 'internal/delivery-proofs', version: '1' })
export class DeliveryProofsController {
  constructor(private readonly proofs: DeliveryProofsService) {}
  @Post() initiate(@Body() body: InitiateProof) {
    return this.proofs.initiate(body);
  }
  @Post(':id/complete') complete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ProofBinding,
  ) {
    return this.proofs.complete(id, body);
  }
  @Post(':id/read') read(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ProofBinding,
  ) {
    return this.proofs.read(id, body);
  }
}
