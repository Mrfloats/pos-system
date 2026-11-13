import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { MailService } from './mail.service.js';

@Global()
@Module({
  providers: [AuditService, MailService],
  exports: [AuditService, MailService],
})
export class CommonModule {}
