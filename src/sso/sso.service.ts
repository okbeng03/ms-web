import * as fs from 'fs/promises'
import { createWriteStream, createReadStream } from 'fs'
import { Buffer } from 'buffer'
import { Readable } from 'stream'
const path = require('path')
import { Injectable, Inject, CACHE_MANAGER } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bull'
import { Cache } from 'cache-manager'
import { InjectQueue } from '@nestjs/bull'
import { remove, pick } from 'lodash'
import { MINIO_CLIENT, SOURCE_DIR, MIN_DIR, THUMB_DIR, NO_GROUP_BUCKET, OTHERS_BUCKET, CACHE_BUCKETS, VIDEO_BUCKET } from 'src/constants'
const walker = require('folder-walker')
import { isImageFile, isVideoFile, parseTagging } from 'src/lib/util'
const archiver = require('archiver')
import * as moment from 'moment'

const regQQ = /^(\d{4})_(\d{4}-\d{2}-\d{2})_\S+(\.\w+)$/
@Injectable()
export class SsoService {
  private root
  private downloadRoot

  constructor(
    @Inject(MINIO_CLIENT) private readonly minioClient,
    @InjectQueue('album') private albumQueue: Queue,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService
  ) {
    this.root = configService.get<string>('MINIO_SERVER_ROOT')
    this.downloadRoot = configService.get<string>('DOWNLOAD_DIR')
  }

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

          if (obj.tags?.source) {
            obj.source = '/sso/' + obj.tags?.source
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
          const tags = await this.minioClient.getBucketTagging(bucket.name)

          bucket.tags = parseTagging(tags)
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
            const tags = await this.minioClient.getObjectTagging(bucketName, obj.name)
            obj.tags = parseTagging(tags)
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
      // 先判断分桶是否存在，不存在就创建分桶
      const exists = await this.minioClient.bucketExists(bucketName)

      if (!exists) {
        await this.minioClient.makeBucket(bucketName)
      }

      return await this.minioClient.putObject(bucketName, objectName, stream)
    } catch(err) {
      throw err
    }
  }

  async getObject(bucketName: string, objectName: string) {
    return new Promise((resolve, reject) => {
      let size = 0
      let data = []
      this.minioClient.getObject(bucketName, objectName, function(err, dataStream) {
        if (err) {
          reject(err)
          return
        }
        dataStream.on('data', function(chunk) {
          data.push(chunk)
          size += chunk.length
        })
        dataStream.on('end', function() {
          const buf = Buffer.concat(data)
          const stream = Readable.from(buf)
          resolve({
            stream: stream,
            size
          })
        })
        dataStream.on('error', function(err) {
          reject(err)
        })
      })
    })
  }

  // 复制
  async copyObject(bucketName: string, objectName: string, sourceObject: string, removeSource?: boolean) {
    try {
      // 先判断分桶是否存在，不存在就创建分桶
      const exists = await this.minioClient.bucketExists(bucketName)

      if (!exists) {
        await this.minioClient.makeBucket(bucketName)
      }

      await this.minioClient.copyObject(bucketName, objectName, sourceObject)

      if (removeSource) {
        const source = sourceObject.split('/')
        await this.removeObject(source.shift(), source.join('/'))
      }

      return true
    } catch(err) {
      throw err
    }
  }

  // 复制相片
  async copyPhoto(bucketName: string, objectName: string, sourceObject: string, removeSource?: boolean) {
    try {
      // 复制之后记录下source新增相册，后期移除的时候才能知道什么时候清除source
      await this.copyObject(bucketName, objectName, sourceObject, removeSource)

      const tTags = await this.minioClient.getObjectTagging(bucketName, objectName)
      const tTagging: any = parseTagging(tTags)
      const sPath = tTagging.source.split('/')
      const sBucketName = sPath.shift()
      const source = sPath.join('/')
      const tags = await this.minioClient.getObjectTagging(sBucketName, source)
      const tagging: any = parseTagging(tags)
      const refs = tagging.refs ? tagging.refs.split(',') : []

      const newObject = path.join(bucketName, objectName)
      const nIdx = refs.findIndex(item => item === newObject)

      if (nIdx < 0) {
        refs.push(newObject)
      }

      if (removeSource) {
        // 删除源文件，要把源文件的ref去掉
        const sIdx = refs.findIndex(item => item === sourceObject)

        if (sIdx > -1) {
          refs.splice(sIdx, 1)
        }
      }

      await this.pubObjectTagging(sBucketName, source, {
        refs: refs.join(',')
      })

      return true
    } catch(err) {
      console.log('copyPhoto error:: ', err)
      throw err
    }
  }

  // 批量复制
  async copyObjects(bucketName: string, list: Array<string>, newBucketName: string, removeSource?: boolean) {
    try {
      for (const item of list) {
        await this.copyPhoto(newBucketName, item, path.join(bucketName, item), removeSource)
      }

      return true
    } catch (err) {
      throw err
    }
  }

  // 删除
  async removeObject(bucketName: string, objectName: string) {
    try {
      return await this.minioClient.removeObject(bucketName, objectName)
    } catch(err) {
      throw err
    }
  }

  // 批量删除
  async removeObjects(bucketName: string, objectsList: Array<string>) {
    try {
      for (const objectName of objectsList) {
        const tTags = await this.minioClient.getObjectTagging(bucketName, objectName)
        const tTagging: any = parseTagging(tTags)
        const sPath = tTagging.source.split('/')
        const sBucketName = sPath.shift()
        const source = sPath.join('/')
        const tags = await this.minioClient.getObjectTagging(sBucketName, source)
        const tagging: any = parseTagging(tags)
        const refs = tagging.refs ? tagging.refs.split(',') : []
        const idx = refs.findIndex(item => item === bucketName + '/' + objectName)

        if (idx > -1) {
          refs.splice(idx, 1)
        }

        // 清除完tags.refs，清除source文件
        if (!refs.length) {
          await this.removeObject(sBucketName, source)
        } else {
          await this.pubObjectTagging(sBucketName, source, {
            refs: refs.join(',')
          })
        }

        await this.removeObject(bucketName, objectName)
      }
    } catch(err) {
      throw err
    }
  }

  // 上传文件
  async upload(file) {
    try {
      // const { originalname: basename, mimetype, buffer: stream } = file
      const { originalname, mimetype, buffer: stream } = file
      const match = originalname.match(regQQ)
      let basename

      if (match) {
        basename = moment(match[2], 'YYYY-MM-DD').add(match[1] - 0, 's').valueOf() + match[3]
      } else {
        basename = originalname
      }

      if (isImageFile(mimetype)) {
        // 图片上传
        const name = 'IMG__' + basename
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
          delay: 1000
        })

        // 人脸识别队列
        await this.albumQueue.add('recognition', {
          bucketName: NO_GROUP_BUCKET,
          basename: name,
          objectName: sourcePath,
          thumbName: thumbPath,
          sourcePath: file.filepath || null,
          removeSource: file.removeSource || false
        }, {
          delay: 3000
        })
      } else if (isVideoFile(mimetype)) {
        // 视频上传
        // 存入视频目录
        const name = 'VIDEO__' + basename
        const sourcePath = path.join(SOURCE_DIR, name)
        await this.putObject(VIDEO_BUCKET, sourcePath, stream)

        // 人脸识别分桶
        await this.albumQueue.add('video', {
          bucketName: VIDEO_BUCKET,
          basename: name,
          objectName: sourcePath
        }, {
          delay: 10000
        })

        // 删除源文件
        if (file.removeSource) {
          await fs.rm(file.filepath)
        }
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

  async getObjectTagging(bucketName: string, objectName: string) {
    try {
      const tags = await this.minioClient.getObjectTagging(bucketName, objectName)
      const tagging = parseTagging(tags)

      return tagging
    } catch (err) {
      throw err
    }
  }

  // add object tag
  async pubObjectTagging(bucketName: string, objectName: string, tags) {
    try {
      // const source = path.join(SOURCE_DIR, path.basename(objectName))
      const tag = await this.minioClient.getObjectTagging(bucketName, objectName)
      const tagging: any = parseTagging(tag)

      await this.minioClient.setObjectTagging(bucketName, objectName, {
        ...tagging,
        ...tags
      })
    } catch (err) {
      throw err
    }
  }

  // 重新识别
  async reRecognition(bucketName, objects) {
    try {
      for (const obj of objects) {
        const name = path.basename(obj.name)
        const sourceName = path.join(SOURCE_DIR, name)

        // 人脸识别队列
        await this.albumQueue.add('recognition', {
          bucketName: bucketName,
          basename: name,
          objectName: sourceName,
          thumbName: obj.name,
          sourcePath: null,
          removeSource: false,
          reRecognition: true
        }, {
          delay: 1000
        })
      }
    } catch (err) {
      console.log('reRecognition error::', err)
      throw err
    }
  }

  // 编辑相册
  async update(data) {
    try {
      const { bucketName, values } = data
      let tags
      // 处理保留值
      try {
        tags = await this.minioClient.getBucketTagging(bucketName)
      } catch (err) {}
      const tagging = parseTagging(tags)
      const inheritValues = pick(tagging, ['type'])

      await this.minioClient.removeBucketTagging(bucketName)
      await this.minioClient.setBucketTagging(bucketName, {
        ...values,
        ...inheritValues
      })

      return true
    } catch (err) {
      console.log('update error::', err)
      throw err
    }
  }

  // 批量下载::打包下载
  download(bucketName: string, list: Array<string>): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const { downloadRoot } = this
        const filePath = path.join(downloadRoot, `${new Date().getTime()}.zip`)
        const output = createWriteStream(filePath)
        const archive = archiver('zip', {
          zlib: { level: 9 }
        })

        output.on('close', async () => {
          // 删除队列
          await this.albumQueue.add('download', {
            filePath
          }, {
            delay: 24 * 60 * 60 * 1000
          })
          
          resolve(filePath)
        })

        archive.on('warning', function(err) {
          console.log('archive warning::', err)
          reject(err)
        })
        
        archive.on('error', function(err) {
          console.log('archive eror::', err)
          reject(err)
        })

        archive.pipe(output)

        for (const objectName of list) {
          const tags = await this.minioClient.getObjectTagging(bucketName, objectName)
          const tagging: any = parseTagging(tags)
          const basename = path.basename(tagging.source)
          const source = tagging.source.split('/')
          const { stream }: any = await this.getObject(source.shift(), path.join(...source))
          archive.append(stream, { name: basename })
        }

        archive.finalize()
      } catch (err) {
        console.log('download error::', err)
        reject(err)
      }
    })
  }
}
