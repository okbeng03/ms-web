import { Inject, Controller, Post, Body, HttpException, HttpStatus, Get, Param, UploadedFile, UseInterceptors } from '@nestjs/common'
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

  // 移除单张相片
  @Post('remove')
  async removeObject(@Body() objectDto: {bucketName: string, objectName: string}) {
    try {
      await this.minioClient.removeObject(objectDto.bucketName, objectDto.objectName)
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 批量移除相片
  @Post('removes')
  async removeObjects(@Body() objectDto: {bucketName: string, objectsList: Array<string>}) {
    try {
      await this.minioClient.removeObjects(objectDto.bucketName, objectDto.objectsList)
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

  // 移动目录
  @Post('copy')
  async copyPhoto() {

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
}
