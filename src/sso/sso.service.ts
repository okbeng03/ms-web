import * as fs from 'fs/promises'
const path = require('path')
import { Injectable, Inject } from '@nestjs/common'
import { Queue } from 'bull'
import { InjectQueue } from '@nestjs/bull'
import { MINIO_CLIENT } from 'src/constants'
const walker = require('folder-walker')
import { isImageFile } from 'src/lib/util'

@Injectable()
export class SsoService {
  constructor(@Inject(MINIO_CLIENT) private readonly minioClient, @InjectQueue('album') private albumQueue: Queue) {}

  async putObject(bucketName: string, objectName: string, stream) {
    try {
      return await this.minioClient.putObject(bucketName, objectName, stream)
    } catch(err) {
      throw err
    }
  }

  async fputObject() {
  }

  async copyObject(bucketName: string, objectName: string, sourceObject: string) {
    try {
      // 先判断分桶是否存在，不存在就创建分桶
      const exists =await this.minioClient.bucketExists(bucketName)

      if (!exists) {
        await this.minioClient.makeBucket(bucketName)
      }

      return await this.minioClient.copyObject(bucketName, objectName, sourceObject)
    } catch(err) {
      throw err
    }
  }

  async removeObject(bucketName: string, objectName: string) {
    try {
      return await this.minioClient.removeObject(bucketName, objectName)
    } catch(err) {
      throw err
    }
  }

  async syncFile(syncDto: {path: string, removeSource?: boolean}) {
    return new Promise(async (resolve, reject) => {
      try {
        const state = await fs.stat(syncDto.path)
  
        if (!state.isDirectory()) {
          throw new Error('请确认该文件夹目录是否存在！')
        }
  
        // 遍历目录文件
        const fileList = []
        const stream = walker([syncDto.path])
        stream.on('data', function (data) {
          // 非私密文件才上传
          if (data.type === 'file' && data.basename.indexOf('.') !== 0) {
            fileList.push(data.filepath)
          }
        })
        stream.on('end', async () => {
          for(const filepath of fileList) {
            try {
              // 上传sso
              const basename = path.basename(filepath)
              const fd = await fs.open(filepath, 'r')
              const stream = fd.createReadStream()

              if (isImageFile(filepath)) {
                // 图片上传
                const name = new Date().getTime() + '_' + basename
                const sourcePath = 'source/' + name
                const minPath = 'min/' + name
                await this.putObject('ms-nogroup', sourcePath, stream)

                // 压缩队列
                await this.albumQueue.add('imagemin', {
                  bucketName: 'ms-nogroup',
                  objectName: sourcePath,
                  minObjectName: minPath
                })

                // TODO::缩略图队列
                // await this.albumQueue.add('thumbnail', {
                //   pucketName: 'ms-nogroup',
                //   objectName: name
                // })

                // 人脸识别队列
                await this.albumQueue.add('recognition', {
                  bucketName: 'ms-nogroup',
                  objectName: sourcePath,
                  minObjectName: minPath,
                  sourcePath: filepath,
                  removeSource: syncDto.removeSource
                }, {
                  delay: 10000
                })
              } else {
                await this.putObject('others', basename, stream)

                // 删除源文件
                if (syncDto.removeSource) {
                  await fs.rm(filepath)
                }
              }
            } catch (err) {
              reject(err)
            }
          }

          
          resolve(null)
        })
        stream.on('error', function(err) {
          reject(err)
        })
      } catch (err) {
        reject(err)
      }
    })
  }
}
