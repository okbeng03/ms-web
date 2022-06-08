import * as fs from 'fs/promises'
import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common'
import { Stream } from 'stream'
import { FaceaiService } from './faceai.service'

@Controller('api/faceai')
export class FaceaiController {
  constructor(private readonly faceaiService: FaceaiService) {}

  @Post('addSubject')
  async addSubject(@Body() subject: {name: string}) {
    try {
      await this.faceaiService.addSuject(subject.name)
    } catch(err) {
      throw new HttpException(err?.response?.data.message || err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  @Post('addCollection')
  async addCollection(@Body() collection: {image: string | Stream, subject: string}) {
    try {
      let stream: Stream

      if (typeof collection.image === 'string') {
        const fd = await fs.open(collection.image, 'r')
        stream = fd.createReadStream()
      } else {
        stream = collection.image
      }

      await this.faceaiService.addCollection(stream, collection.subject)
    } catch(err) {
      throw new HttpException(err?.response?.data.message || err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }
}
