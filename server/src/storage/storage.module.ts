import { Module } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

@Module({
  controllers: [StorageController],
  providers: [StorageService, CryptoService],
  exports: [StorageService],
})
export class StorageModule {}
