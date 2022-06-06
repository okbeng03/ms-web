import { Module } from '@nestjs/common'
import { SsoModule } from 'src/sso/sso.module'
import { FaceaiService } from './faceai.service'

@Module({
  providers: [FaceaiService],
  exports: [FaceaiService]
})
export class FaceaiModule {}
