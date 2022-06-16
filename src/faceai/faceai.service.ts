import * as fs from 'fs/promises'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CompreFace } from '@exadel/compreface-js-sdk'
const base64Img = require('base64-img')
import * as path from 'path'
import * as ffmpeg from 'fluent-ffmpeg'
import * as walker from 'folder-walker'
@Injectable()
export class FaceaiService {
  private compreFace
  private recognitionService
  private faceCollection
  private subjects
  private collectionDir
  private videoRoot

  constructor(private configService: ConfigService) {
    const url = configService.get<string>('COMPREFACE_URL')
    const port = configService.get<string>('COMPREFACE_PORT')
    const key = configService.get<string>('COMPREFACE_KEY')
    this.collectionDir = configService.get<string>('COLLECTION_DIR')

    const compreFace = this.compreFace = new CompreFace(url, port)
    const recognitionService = this.recognitionService = compreFace.initFaceRecognitionService(key)
    this.faceCollection = recognitionService.getFaceCollection()
    this.subjects = recognitionService.getSubjects()
    this.videoRoot = configService.get<string>('VIDEO_DIR')
  }

  async subjectList() {
    try {
      return await this.subjects.list()
    } catch (err) {
      throw err
    }
  }

  async addSubject(subject: string) {
    try {
      return await this.subjects.add(subject)
    } catch (err) {
      throw err
    }
  }

  async addCollection(image, subject: string) {
    return new Promise((resolve, reject) => {
      base64Img.img(image, this.collectionDir, new Date().getTime(), async (err, filepath) => {
        if (err) {
          reject(err)
        }
        
        try {
          const fd = await fs.open(filepath, 'r')
          const stream = fd.createReadStream()
          await this.faceCollection.add(stream, subject)
          await fs.rm(filepath)
          resolve(null)
        } catch(err) {
          await fs.rm(filepath)
          reject(err)
        }
      })
    })
  }

  async recognize(stream) {
    try {
      const { result } = await this.recognitionService.recognize(stream, {
        limit: 0,
        det_prob_threshold: 0.8,
        prediction_count: 1,
        face_plugins: 'calculator,age,gender,landmarks',
        status: 'true'
      })
      const list = []

      result.forEach(({box, subjects}) => {
        // 认为是人像
        if (box.probability >= 0.9) {
          if (!subjects.length) {
            list.push({
              isRecognition: false
            })
            return
          }

          subjects.sort((a, b) => {
            return a.similarity - b.similarity
          })

          list.push({
            isRecognition: subjects[0].similarity >= 0.95,
            ...subjects[0]
          })
        }
      })

      return {
        recognition: !!list.length,
        list
      }
    } catch (err) {
      if (err.code === 'ERR_BAD_REQUEST' && err?.response?.data?.message === 'No face is found in the given image') {
        // 非人物照片，移到其他文件分组
        return {
          recognition: false
        }
      } else {
        throw err
      }
    }
  }

  // 逐帧截屏
  async screenshots(input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const basename = path.basename(input)
      const output = path.join(this.videoRoot, basename, 'screenshot-%i.jpg')
      const outputPath = path.parse(output)

      ffmpeg(input)
        .on('end', () => {
          resolve(outputPath.dir)
        })
        .on('err', (err) => {
          reject(err)
        })
        .screenshots({
          folder: outputPath.dir,
          filename: outputPath.base,
          count: 6
        })
    })
  }

  // 视频人脸识别
  async videoRecognize(bucketName: string, objectName: string, output: string) {
    return new Promise((resolve, reject) => {
      const fileList = []
      const stream = walker([output])
      stream.on('data', function (data) {
        // 非私密文件才上传
        if (data.type === 'file' && data.basename.indexOf('.') !== 0) {
          fileList.push(data.filepath)
        }
      })
      stream.on('end', async () => {
        const results = []

        for(const filepath of fileList) {
          try {
            const fd = await fs.open(filepath, 'r')
            const result = await this.recognize(fd.createReadStream())
            
            if (result.recognition) {
              const recoginitionList = result.list.filter(item => item.isRecognition)

              if (recoginitionList.length) {
                results.push({
                  thumb: filepath,
                  list: recoginitionList
                })
              }
            }
          } catch (err) {
            reject(err)
          }
        }

        if (results.length) {
          // 人脸识别成功，找出最合适的缩略图，分组
          const map: any = {}
          results.forEach(recognize => {
            recognize.list.forEach(item => {
              if (!map[item.subject]) {
                map[item.subject] = recognize.thumb
              }
            })
          })

          resolve({
            recognition: true,
            map
          })
        } else {
          // 人脸识别失败，保存缩略图到默认目录，后续人工自己分组
          resolve({
            recognition: false,
            thumb: fileList[0]
          })
        }
      })
      stream.on('error', function(err) {
        reject(err)
      })
    })
  }
}
