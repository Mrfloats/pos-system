import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { EmailsService } from './emails.service.js';
import { MailService } from './mail.service.js';

@Global()
@Module({
  providers: [AuditService, MailService, EmailsService],
  exports: [AuditService, MailService, EmailsService],
})
export class CommonModule {}
