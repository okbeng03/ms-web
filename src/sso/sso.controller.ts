import { Inject, Controller, Post, Body, HttpException, HttpStatus, Get, Res, UploadedFiles } from '@nestjs/common'
import { Response } from 'express'
import { MINIO_CLIENT } from 'src/constants'
import { SsoService } from './sso.service'

@Controller('sso')
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
      return await this.ssoService.listBuckets()
    } catch(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    }
  }

  // 获取相片数组
  @Post('photos')
  async listObjects(@Body() bucketDto: {bucketName: string, prefix?: string, recursive?: boolean}, @Res() res: Response) {
    // TODO:: 通过tag增加描述功能
    const data = []
    const stream = this.minioClient.listObjects(bucketDto.bucketName, bucketDto.prefix, bucketDto.recursive)
    stream.on('data', function(obj) {
      data.push(obj)
    })
    stream.on('end', function () {
      res.status(HttpStatus.OK).json(data)
    })
    stream.on('error', function(err) {
      throw new HttpException(err.message, HttpStatus.EXPECTATION_FAILED)
    })
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
  async uploadFile(@UploadedFiles() files: Array<Express.Multer.File>) {
    
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
