import * as fs from 'fs/promises'
import { Processor, Process } from '@nestjs/bull'
import { Job } from 'bull'
import { ConfigService } from '@nestjs/config'
const path = require('path')
import { imagemin } from 'src/lib/imagemin'
import { SsoService } from './sso.service'

@Processor('album')
export class AlbumConsumer {
  private root
  private imageminRoot
  constructor(private configService: ConfigService, private ssoService: SsoService) {
    this.root = configService.get<string>('MINIO_SERVER_ROOT')
    this.imageminRoot = configService.get<string>('IMAGEMIN_DIR')
  }

  @Process('imagemin')
  async imagemin(job: Job) {
    try {
      const { root, imageminRoot } = this
      const { bucketName, objectName, minObjectName } = job.data
      const filepath = path.join(root, bucketName, objectName)

      // 判断图片小于1M就不压缩，直接同步到压缩文件夹
      const stat = await fs.stat(filepath)

      if (stat.size >= 1000000) {
        await imagemin(filepath, imageminRoot)
        job.progress(50)
        
        // 图片上传
        const basename = path.basename(objectName)
        const minFilepath = path.join(imageminRoot, basename)
        const fd = await fs.open(minFilepath, 'r')
        const stream = fd.createReadStream()

        await this.ssoService.putObject(bucketName, minObjectName, stream)
        job.progress(90)

        // 删除文件
        await fs.rm(minFilepath)
        job.progress(100)
        console.log('imagemin success:: ', objectName)
      } else {
        await this.ssoService.copyObject(bucketName, minObjectName,  path.join(bucketName, objectName))
        console.log('copy success:: ', objectName)
      }
    } catch (err) {
      console.log('imagemin error:: ', err)
      throw err
    }
  }

  @Process('recognition')
  async recognition(job: Job<unknown>) {
    
  }

  @Process('thumbnail')
  async thumbnail(job: Job<unknown>) {
    
  }
}
