import { Injectable, Inject, forwardRef } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CompreFace } from '@exadel/compreface-js-sdk'

@Injectable()
export class FaceaiService {
  private compreFace
  private recognitionService
  private faceCollection
  private subjects

  constructor(private configService: ConfigService) {
    const url = configService.get<string>('COMPREFACE_URL')
    const port = configService.get<string>('COMPREFACE_PORT')
    const key = configService.get<string>('COMPREFACE_KEY')

    const compreFace = this.compreFace = new CompreFace(url, port)
    const recognitionService = this.recognitionService = compreFace.initFaceRecognitionService(key)
    this.faceCollection = recognitionService.getFaceCollection()
    this.subjects = recognitionService.getSubjects()
  }

  async addSuject(subject: string) {
    try {
      return this.subjects.add(subject)
    } catch (err) {
      throw err
    }
  }

  async addCollection(filepath: string, subject: string) {
    try {
      return await this.faceCollection.add(filepath, subject)
    } catch (err) {
      throw err
    }
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
          subjects.sort((a, b) => {
            return a.similarity - b.similarity
          })

          list.push({
            isRecognition: subjects[0].similarity >= 0.9,
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
}
