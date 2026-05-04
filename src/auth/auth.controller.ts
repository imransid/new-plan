import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SignUpDto, SignInDto, AuthResponseDto } from './dto/auth.dto';
import { SignUpCommand } from './commands/sign-up.command';
import { SignInCommand } from './commands/sign-in.command';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('signup')
  @ApiOperation({ summary: 'Create a new account' })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  signUp(@Body() dto: SignUpDto): Promise<AuthResponseDto> {
    return this.commandBus.execute(
      new SignUpCommand(dto.email, dto.password, dto.name, dto.timezone),
    );
  }

  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  signIn(@Body() dto: SignInDto): Promise<AuthResponseDto> {
    return this.commandBus.execute(new SignInCommand(dto.email, dto.password));
  }
}
