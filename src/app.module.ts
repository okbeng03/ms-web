import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ConfigModule } from '@nestjs/config'
import { SsoModule } from './sso/sso.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    SsoModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
