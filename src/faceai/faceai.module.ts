import { Module } from '@nestjs/common'
import { FaceaiController } from './faceai.controller'
import { FaceaiService } from './faceai.service'

@Module({
  controllers: [FaceaiController],
  providers: [FaceaiService],
  exports: [FaceaiService]
})
export class FaceaiModule {}
