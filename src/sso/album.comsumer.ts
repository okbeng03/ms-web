import * as fs from 'fs/promises'
import { createReadStream } from 'fs'
import { Processor, Process } from '@nestjs/bull'
import { Job } from 'bull'
import { ConfigService } from '@nestjs/config'
const path = require('path')
const gm = require('gm')
import sizeOf from 'image-size'
import { imagemin } from 'src/lib/imagemin'
import { SsoService } from './sso.service'
import { FaceaiService } from 'src/faceai/faceai.service'
import { NEED_RECOGNITION_BUCKET, BUCKET_PREFIX, OTHER_BUCKET, NO_GROUP_BUCKET, THUMB_DIR, VIDEO_BUCKET } from 'src/constants'
@Processor('album')
export class AlbumConsumer {
  private root
  private imageminRoot
  private thumbRoot
  private videoRoot

  constructor(private configService: ConfigService, private ssoService: SsoService, private faceaiService:FaceaiService) {
    this.root = configService.get<string>('MINIO_SERVER_ROOT')
    this.imageminRoot = configService.get<string>('IMAGEMIN_DIR')
    this.thumbRoot = configService.get<string>('THUMB_DIR')
    this.videoRoot = configService.get<string>('VIDEO_DIR')
  }

  @Process('imagemin')
  async imagemin(job: Job) {
    try {
      const { root, imageminRoot } = this
      const { bucketName, basename, objectName, minObjectName } = job.data
      const filepath = path.join(root, bucketName, objectName)

      // 判断图片小于1M就不压缩，直接同步到压缩文件夹
      const stat = await fs.stat(filepath)

      if (stat.size >= 5000000) {
        await imagemin(filepath, imageminRoot)
        job.progress(50)
        
        // 图片上传
        const minFilepath = path.join(imageminRoot, basename)
        const fd = await fs.open(minFilepath, 'r')
        const stream = fd.createReadStream()

        await this.ssoService.putObject(bucketName, minObjectName, stream)
        await this.ssoService.pubObjectTagging(bucketName, objectName, {
          mini: minObjectName
        })
        job.progress(90)

        // 删除文件
        await fs.rm(minFilepath)
        job.progress(100)
        console.log('imagemin success:: ', objectName)
      } else {
        console.log('no need imagemin:: ', objectName)
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
      const { bucketName, basename, objectName, minObjectName, thumbName, sourcePath, removeSource, reRecognition = false } = job.data
      
      const tagging: any = await this.ssoService.getObjectTagging(NO_GROUP_BUCKET, objectName)
      const filepath = path.join(root, NO_GROUP_BUCKET, tagging.mini || objectName)
      const fd = await fs.open(filepath, 'r')
      const stream = fd.createReadStream()
      const { recognition, list = [] } = await this.faceaiService.recognize(stream)

      if (recognition) {
        const recoginitionList = list.filter(item => item.isRecognition)

        if (!reRecognition && recoginitionList.length !== list.length) {
          const newBucketName = NEED_RECOGNITION_BUCKET
          await this.ssoService.copyPhoto(newBucketName, thumbName, path.join(bucketName, thumbName))
        }

        for (const subject of recoginitionList) {
          const newBucketName = `${BUCKET_PREFIX}-${subject.subject.toLocaleLowerCase()}`
          await this.ssoService.copyPhoto(newBucketName, thumbName, path.join(bucketName, thumbName))
        }

        if (reRecognition && recoginitionList.length !== list.length) {
          console.log('recoginition success:: ', objectName)
          return
        }
      } else {
        const newBucketName = OTHER_BUCKET
        await this.ssoService.copyPhoto(newBucketName, thumbName, path.join(bucketName, thumbName))
      }

      // 删除原分桶文件
      await this.ssoService.removeObject(bucketName, thumbName)

      // 删除原始文件
      if (removeSource) {
        await fs.rm(sourcePath)
      }

      console.log('recoginition success:: ', objectName)
    } catch (err) {
      console.log('recognition error:: ', job.data.objectName, err)
    }
  }

  @Process('thumbnail')
  async thumbnail(job: Job) {
    try {
      await this.makeThumbnail(job.data)
      console.log('thumbnail success::', job.data.objectName)
    } catch (err) {
      console.log('thumbnail error::', job.data.objectName, err)
    }
  }

  @Process('download')
  async download(job: Job) {
    try {
      const { filePath } = job.data

      // 删除文件
      await fs.rm(filePath)

      console.log('download file remove success::', filePath)
    } catch (err) {
      console.log('download error::', job.data, err)
    }
  }

  @Process('video')
  async video(job: Job) {
    try {
      const { bucketName, basename, objectName } = job.data
      const filePath = path.join(this.root, bucketName, objectName)

      // 逐帧截屏
      const output = await this.faceaiService.screenshots(filePath)

      const dimensions = sizeOf(path.join(output, 'screenshot-1.jpg'))
      const tags = {
        width: dimensions.width,
        height: dimensions.height
      }

      // 人脸识别
      const result: any = await this.faceaiService.videoRecognize(bucketName, objectName, output)
      const extname = path.extname(basename)
      const name = path.basename(basename, extname) + '.jpg'
      const thumbName = path.join(THUMB_DIR, name)

      if (result.recognition) {
        // 识别成功
        for (const key in result.map) {
          const newBucketName = `${BUCKET_PREFIX}-${key.toLocaleLowerCase()}`
          await this.makeThumbnail({
            bucketName: NO_GROUP_BUCKET,
            basename: name,
            input: result.map[key],
            objectName,
            thumbName,
            source: path.join(bucketName, objectName),
            tagging: tags
          })
          await this.ssoService.copyPhoto(newBucketName, thumbName, path.join(NO_GROUP_BUCKET, thumbName))
        }
      } else {
        // 识别失败
        await this.makeThumbnail({
          bucketName: NO_GROUP_BUCKET,
          basename: name,
          input: result.thumb,
          objectName,
          thumbName,
          source: path.join(bucketName, objectName),
          tagging: tags
        })
        await this.ssoService.copyPhoto(VIDEO_BUCKET, thumbName, path.join(NO_GROUP_BUCKET, thumbName))
      }

      await fs.rm(output, {
        recursive: true,
        force: true
      })

      console.log('video success::', objectName, output)
    } catch (err) {
      console.log('video error::', job.data, err)
    }
  }

  async makeThumbnail(data) {
    return new Promise((resolve, reject) => {
      try {
        const { root, thumbRoot } = this
        const { bucketName, basename, objectName, thumbName, input, source, tagging = {} } = data
        const filepath = input || path.join(root, bucketName, objectName)
        const output = path.join(thumbRoot, basename)

        gm(filepath)
          .resize(320, 320)
          .noProfile()
          .write(output, async(err) => {
            if (err) {
              console.log('thumbnail gm error::', objectName, err)
              return
            }

            try {
              const fd = await fs.open(output, 'r')
              const stream = fd.createReadStream()

              await this.ssoService.putObject(bucketName, thumbName, stream)

              // 添加tag指向源文件
              const tag: any = {
                source: source || path.join(bucketName, objectName),
                ...tagging
              }

              // 判断文件名是否正确的日期
              const time = new Date(basename.split('__')[1].replace(/\.\w+$/, '') - 0).getTime()

              if (time) {
                tag.orginTime = time
              }

              await this.ssoService.pubObjectTagging(bucketName, thumbName, tag)

              // 删除文件
              await fs.rm(output)

              resolve(null)
            } catch (err) {
              reject(err)
            }
          })
      } catch (err) {
        reject(err)
      }
    })
  }
}
