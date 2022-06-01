import { Module, DynamicModule } from '@nestjs/common'
import * as Minio from 'minio'
import { MINIO_CLIENT } from 'src/constants'

@Module({})
export class MinioModule {
  static register(options: Minio.ClientOptions & { global?: boolean }): DynamicModule {
    const minioFactory = {
      provide: MINIO_CLIENT,
      useFactory: () => {
        return new Minio.Client({
          ...options,
          region: 'cn-north-1'
        })
      }
    }

    return {
      global: options.global,
      module: MinioModule,
      providers: [minioFactory],
      exports: [minioFactory]
    }
  }
}
