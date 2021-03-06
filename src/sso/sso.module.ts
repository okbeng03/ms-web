import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { SsoController } from './sso.controller'
import { SsoService } from './sso.service'
import { AlbumConsumer } from './album.comsumer'
import { MinioModule } from 'src/minio/minio.module'
import { FaceaiModule } from 'src/faceai/faceai.module'

@Module({
  controllers: [SsoController],
  providers: [SsoService, AlbumConsumer],
  exports: [SsoService],
  imports: [
    MinioModule.register({
      endPoint: '127.0.0.1',
      // endPoint: '192.168.3.182',
      port: 9000,
      useSSL: false,
      accessKey: 'minioadmin',
      secretKey: 'minioadmin'
    }),
    BullModule.registerQueue({
      name: 'album',
      redis: {
        host: 'localhost',
        port: 6379
      }
    }),
    FaceaiModule
  ]
})
export class SsoModule {}
