import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class SignUpDto {
  @ApiProperty({ example: 'rashid@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongP@ss123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Rashid Ahmed', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'Asia/Dhaka', required: false })
  @IsString()
  @IsOptional()
  timezone?: string;
}

export class SignInDto {
  @ApiProperty({ example: 'rashid@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongP@ss123' })
  @IsString()
  password!: string;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  user!: {
    id: string;
    email: string;
    name: string | null;
    timezone: string;
  };
}
