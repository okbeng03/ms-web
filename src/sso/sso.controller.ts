import { createReadStream } from 'fs'
import { Inject, Controller, Post, Body, HttpException, HttpStatus, Get, Param, UploadedFile, UseInterceptors, StreamableFile } from '@nestjs/common'
import { Express } from 'express'
import { FileInterceptor } from '@nestjs/platform-express'
import { MINIO_CLIENT } from 'src/constants'
import { SsoService } from './sso.service'

@Controller('api/sso')
export class SsoController {
  constructor(@Inject(MINIO_CLIENT) private readonly minioClient, private ssoService: SsoService) {}

  // 新建分桶
  @Post('create')
  async makeBucket(@Body() bucketDto: {bucketName: string}) {
    try {
      await this.minioClient.makeBucket(bucketDto.bucketName)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 相册
  @Get('albums')
  async listBuckets() {
    try {
      return await this.ssoService.getBuckets()
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 获取相片数组
  @Get('photos/:id')
  async listObjects(@Param() params) {
    try {
      return await this.ssoService.getPhotos(params.id)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 批量移除相片
  @Post('remove')
  async removeObjects(@Body() objectDto: {bucketName: string, objectsList: Array<string>}) {
    try {
      await this.ssoService.removeObjects(objectDto.bucketName, objectDto.objectsList)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 上传相片
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fieldSize: 102400000
      }
    })
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    try {
      await this.ssoService.upload(file)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 复制
  @Post('copy')
  async copyObjects(@Body() body: {bucketName: string, list: Array<string>, newBucketName: string}) {
    try {
      await this.ssoService.copyObjects(body.bucketName, body.list, body.newBucketName)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 移动
  @Post('move')
  async moveObjects(@Body() body: {bucketName: string, list: Array<string>, newBucketName: string}) {
    try {
      await this.ssoService.copyObjects(body.bucketName, body.list, body.newBucketName, true)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 同步相片
  @Post('sync')
  async syncFile(@Body() syncDto: {path: string, removeSource?: boolean}) {
    try {
      await this.ssoService.syncFile(syncDto)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 重新识别
  @Post('reRecognition')
  async reRecognition(@Body() body: {bucketName: string, objects}) {
    try {
      await this.ssoService.reRecognition(body.bucketName, body.objects)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 相册编辑
  @Post('update')
  async update(@Body() body) {
    try {
      return await this.ssoService.update(body)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 批量下载
  @Post('download')
  async download(@Body() body: {bucketName: string, list: Array<string>}): Promise<StreamableFile> {
    try {
      const filePath = await this.ssoService.download(body.bucketName, body.list)
      const file = createReadStream(filePath)

      return new StreamableFile(file)
    } catch(err) {
      console.log(222, err)
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }
}
