import * as fs from 'fs/promises'
const path = require('path')
import { Injectable, Inject, CACHE_MANAGER } from '@nestjs/common'
import { Queue } from 'bull'
import { Cache } from 'cache-manager'
import { InjectQueue } from '@nestjs/bull'
import { remove } from 'lodash'
import { MINIO_CLIENT, SOURCE_DIR, MIN_DIR, THUMB_DIR, NO_GROUP_BUCKET, OTHERS_BUCKET, CACHE_BUCKETS } from 'src/constants'
const walker = require('folder-walker')
import { isImageFile } from 'src/lib/util'

@Injectable()
export class SsoService {
  constructor(@Inject(MINIO_CLIENT) private readonly minioClient, @InjectQueue('album') private albumQueue: Queue, @Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  // 获取相册列表
  async getBuckets() {
    try {
      // let buckets: Array<any> = await this.cacheManager.get(CACHE_BUCKETS)

      // if (!buckets) {
        // buckets = await this.listBuckets()
      // }
      const buckets = await this.listBuckets()

      return buckets.map(bucket => {
        const objects = bucket.objects
        const len = objects?.length
        const item = {
          name: bucket.name,
          creationDate: bucket.creationDate,
          tags: bucket.tags || {},
          objects: len || 0,
          thumb: ''
        }

        if (len) {
          item.thumb = '/sso/' + path.join(bucket.name, THUMB_DIR, path.basename(objects[len - 1].name))
        }

        return item
      })
    } catch (err) {
      console.log('getBuckets error::', err)
      throw err
    }
  }

  // 获取相片列表
  async getPhotos(bucketName: string) {
    try {
      const buckets: Array<any> = await this.cacheManager.get(CACHE_BUCKETS)
      const bucket = buckets.find(bucket => bucket.name === bucketName)

      if (bucket) {
        bucket.total = bucket.objects?.length || 0
        bucket.objects?.forEach(obj => {
          const name = path.basename(obj.name)

          obj.thumb = '/sso/' + path.join(bucket.name, obj.name)
          obj.source = '/sso/' + path.join(NO_GROUP_BUCKET, obj.tags?.source)

          const time = new Date(name.split('__')[1]).getTime()

          if (time) {
            obj.orginTime = time
          }
        })
      }

      return bucket
    } catch (err) {
      throw err
    }
  }

  // 相册列表
  async listBuckets() {
    try {
      const buckets = await this.minioClient.listBuckets()
      remove(buckets, bucket => bucket.name === OTHERS_BUCKET)

      for (const bucket of buckets) {
        try {
          const objects = await this.listObjects(bucket.name, 'thumb', true)
          bucket.objects = objects
          // 通过tag增加描述功能
          let tags = await this.minioClient.getBucketTagging(bucket.name)

          if (tags) {
            if (Array.isArray(tags[0])) {
              tags = tags[0]
            }

            const tagging = {}
            tags.forEach(item => {
              tagging[item.Key] = item.Value
            })

            bucket.tags = tagging
          }
        } catch (err) {}
      }

      await this.cacheManager.set(CACHE_BUCKETS, buckets)

      return buckets
    } catch (err) {
      console.log('listBuckets error::', err)
      throw err
    }
  }

  // 相片列表
  async listObjects(bucketName: string, prefix: string, recursive: boolean = true) {
    return new Promise((resolve, reject) => {
      const data = []
      const stream = this.minioClient.listObjects(bucketName, prefix, recursive)

      stream.on('data', function(obj) {
        if (!obj.name) {
          return
        }

        data.push(obj)
      })
      stream.on('end', async () => {
        for (const obj of data) {
          try {
            // 通过tag增加描述功能
            let tags = await this.minioClient.getObjectTagging(bucketName, obj.name)
            
            if (tags) {
              if (Array.isArray(tags[0])) {
                tags = tags[0]
              }

              const tagging = {}
              tags.forEach(item => {
                tagging[item.Key] = item.Value
              })
  
              obj.tags = tagging
            }
          } catch (err) {}
        }

        resolve(data)
      })
      stream.on('error', function(err) {
        console.log('listObjects error::', err)
        reject(err)
      })
    })
  }

  async putObject(bucketName: string, objectName: string, stream) {
    try {
      return await this.minioClient.putObject(bucketName, objectName, stream)
    } catch(err) {
      throw err
    }
  }

  async copyObject(bucketName: string, objectName: string, sourceObject: string) {
    try {
      // 先判断分桶是否存在，不存在就创建分桶
      const exists = await this.minioClient.bucketExists(bucketName)

      if (!exists) {
        await this.minioClient.makeBucket(bucketName)
      }

      return await this.minioClient.copyObject(bucketName, objectName, sourceObject)
    } catch(err) {
      throw err
    }
  }

  // 复制相册，同时要复制缩略图
  async copyPhoto(bucketName: string, oldBucketName: string, basename: string, removeSource?: boolean) {
    try {
      // const sourceName = path.join(SOURCE_DIR, basename)
      const thumbName = path.join(THUMB_DIR, basename)

      // await this.copyObject(bucketName, sourceName, path.join(oldBucketName, sourceName))
      await this.copyObject(bucketName, thumbName, path.join(oldBucketName, thumbName))

      if (removeSource) {
        // await this.removeObject(bucketName, sourceName)
        await this.removeObject(bucketName, thumbName)
      }

      return
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

  // 上传文件
  async upload(file) {
    try {
      const { originalname: basename, mimetype, buffer: stream } = file
      if (isImageFile(mimetype)) {
        // 图片上传
        const name = new Date().getTime() + '__' + basename
        const sourcePath = path.join(SOURCE_DIR, name)
        const minPath = path.join(MIN_DIR, name)
        const thumbPath = path.join(THUMB_DIR, name)
        await this.putObject(NO_GROUP_BUCKET, sourcePath, stream)

        // 压缩队列
        await this.albumQueue.add('imagemin', {
          bucketName: NO_GROUP_BUCKET,
          basename: name,
          objectName: sourcePath,
          minObjectName: minPath
        })

        // 缩略图队列
        await this.albumQueue.add('thumbnail', {
          bucketName: NO_GROUP_BUCKET,
          basename: name,
          objectName: sourcePath,
          thumbName: thumbPath
        }, {
          delay: 2000
        })

        // 人脸识别队列
        await this.albumQueue.add('recognition', {
          bucketName: NO_GROUP_BUCKET,
          basename: name,
          objectName: sourcePath,
          minObjectName: minPath,
          thumbName: thumbPath,
          sourcePath: file.filepath || null,
          removeSource: file.removeSource || false
        }, {
          delay: 10000
        })
      } else {
        await this.putObject(OTHERS_BUCKET, basename, stream)

        // 删除源文件
        if (file.removeSource) {
          await fs.rm(file.filepath)
        }
      }
    } catch (err) {
      throw err
    }
  }

  // 同步文件夹
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
              const file = {
                originalname: basename,
                mimetype: path.extname(filepath),
                buffer: stream,
                filepath,
                removeSource: syncDto.removeSource
              }

              await this.upload(file)

              // if (isImageFile(filepath)) {
              //   // 图片上传
              //   const name = new Date().getTime() + '__' + basename
              //   const sourcePath = path.join(SOURCE_DIR, name)
              //   const minPath = path.join(MIN_DIR, name)
              //   const thumbPath = path.join(THUMB_DIR, name)
              //   await this.putObject(NO_GROUP_BUCKET, sourcePath, stream)

              //   // 压缩队列
              //   await this.albumQueue.add('imagemin', {
              //     bucketName: NO_GROUP_BUCKET,
              //     basename: name,
              //     objectName: sourcePath,
              //     minObjectName: minPath
              //   })

              //   // 缩略图队列
              //   await this.albumQueue.add('thumbnail', {
              //     bucketName: NO_GROUP_BUCKET,
              //     basename: name,
              //     objectName: sourcePath,
              //     thumbName: thumbPath
              //   }, {
              //     delay: 2000
              //   })

              //   // 人脸识别队列
              //   await this.albumQueue.add('recognition', {
              //     bucketName: NO_GROUP_BUCKET,
              //     basename: name,
              //     objectName: sourcePath,
              //     minObjectName: minPath,
              //     thumbName: thumbPath,
              //     sourcePath: filepath,
              //     removeSource: syncDto.removeSource
              //   }, {
              //     delay: 10000
              //   })
              // } else {
              //   await this.putObject(OTHERS_BUCKET, basename, stream)

              //   // 删除源文件
              //   if (syncDto.removeSource) {
              //     await fs.rm(filepath)
              //   }
              // }
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

  // add object tag
  async pubObjectTag(bucketName: string, objectName: string, tags) {
    try {
      await this.minioClient.setObjectTagging(bucketName, objectName, tags)
    } catch (err) {
      throw err
    }
  }

  // 重新识别
  async reRecognition(bucketName, objects) {
    try {
      for (const obj of objects) {
        const name = path.basename(obj.name)
        const sourcePath = path.join(SOURCE_DIR, name)
        const minPath = path.join(MIN_DIR, name)

        // 人脸识别队列
        await this.albumQueue.add('recognition', {
          bucketName: bucketName,
          basename: name,
          objectName: sourcePath,
          minObjectName: minPath,
          thumbName: obj.name,
          sourcePath: null,
          removeSource: false
        }, {
          delay: 1000
        })
      }
    } catch (err) {
      throw err
    }
  }
}
