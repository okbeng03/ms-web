import { Controller, Get, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { FaceaiService } from './faceai.service';

@Controller('api/faceai')
export class FaceaiController {
  constructor(private readonly faceaiService: FaceaiService) {}

  @Post('addSubject')
  async addSubject(@Body() subject: {name: string}) {
    try {
      return await this.faceaiService.addSubject(subject.name)
    } catch(err) {
      throw new HttpException(err?.response?.data.message || err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  @Post('addCollection')
  async addCollection(@Body() collection: {image: string, subject: string}) {
    try {
      return await this.faceaiService.addCollection(collection.image, collection.subject)
    } catch(err) {
      throw new HttpException(err?.response?.data.message || err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  @Get('subjects')
  async subjects() {
    try {
      return await this.faceaiService.subjectList()
    } catch(err) {
      throw new HttpException(err?.response?.data.message || err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }
}
