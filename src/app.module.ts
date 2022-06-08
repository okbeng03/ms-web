import { Module, CacheModule } from '@nestjs/common'
import * as redisStore from 'cache-manager-redis-store'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ConfigModule } from '@nestjs/config'
import { SsoModule } from './sso/sso.module'

@Module({
  imports: [
    CacheModule.register({
      store: redisStore,
      host: 'localhost',
      port: 6379,
      ttl: 0,
      isGlobal: true
    }),
    ConfigModule.forRoot({
      isGlobal: true
    }),
    SsoModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
