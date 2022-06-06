import * as fs from 'fs/promises'
import { Processor, Process } from '@nestjs/bull'
import { Job } from 'bull'
import { ConfigService } from '@nestjs/config'
const path = require('path')
import { imagemin } from 'src/lib/imagemin'
import { SsoService } from './sso.service'
import { FaceaiService } from 'src/faceai/faceai.service'

@Processor('album')
export class AlbumConsumer {
  private root
  private imageminRoot
  constructor(private configService: ConfigService, private ssoService: SsoService, private faceaiService:FaceaiService) {
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
        await this.ssoService.copyObject(bucketName, minObjectName, path.join(bucketName, objectName))
        console.log('copy success:: ', objectName)
      }
    } catch (err) {
      console.log('imagemin error:: ', err)
      throw err
    }
  }

  @Process('recognition')
  async recognition(job: Job) {
    try {
      const { root } = this
      const { bucketName, objectName, minObjectName, sourcePath, removeSource } = job.data
      const filepath = path.join(root, bucketName, minObjectName)
      const fd = await fs.open(filepath, 'r')
      const stream = fd.createReadStream()
      const { recognition, list = [] } = await this.faceaiService.recognize(stream)

      if (recognition) {
        // 存在未识别，分到还需识别分组
        const recoginitionList = list.filter(item => item.isRecognition)

        if (recoginitionList.length !== list.length) {
          await this.ssoService.copyObject('ms-needrecognition', objectName, path.join(bucketName, objectName))
        }

        for (const subject of recoginitionList) {
          await this.ssoService.copyObject(`ms-${subject.subject.toLocaleLowerCase()}`, objectName, path.join(bucketName, objectName))
        }
      } else {
        await this.ssoService.copyObject('ms-other', objectName, path.join(bucketName, objectName))
      }

      // 删除原始图和压缩图
      await this.ssoService.removeObject(bucketName, objectName)
      await this.ssoService.removeObject(bucketName, minObjectName)

      // TODO::copy缩略图

      console.log('recoginition success:: ', objectName)
      if (removeSource) {
        await fs.rm(sourcePath)
      }
    } catch (err) {
      console.log('recognition error:: ', job.data.minObjectName, err)
    }
  }

  @Process('thumbnail')
  async thumbnail(job: Job<unknown>) {
    // TODO::缩略图
  }
}
