import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';

import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SignUpHandler } from './commands/sign-up.command';
import { SignInHandler } from './commands/sign-in.command';
import { resolveJwtSecret } from '../common/config/jwt-secret';

const CommandHandlers = [SignUpHandler, SignInHandler];

@Module({
  imports: [
    CqrsModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtSecret(config),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '30d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, ...CommandHandlers],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}
