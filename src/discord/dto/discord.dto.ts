import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ChannelFormat } from "@prisma/client";

export class ChannelSelectionDto {
  @ApiProperty()
  @IsString()
  channelId!: string;

  @ApiProperty()
  @IsString()
  channelName!: string;

  @ApiProperty({ enum: ChannelFormat, default: ChannelFormat.EMBED })
  @IsEnum(ChannelFormat)
  @IsOptional()
  format?: ChannelFormat;

  @ApiProperty({ default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  // ─── New per-channel routing ─────────────────────────────────
  // Whether this channel receives the "TODAY GOAL" post (full task list)
  @ApiProperty({ default: true })
  @IsBoolean()
  @IsOptional()
  postGoals?: boolean;

  // Whether this channel receives the "Work Updated" post (completed tasks)
  @ApiProperty({ default: true })
  @IsBoolean()
  @IsOptional()
  postUpdates?: boolean;
}

export class SaveChannelsDto {
  @ApiProperty()
  @IsString()
  guildId!: string;

  @ApiProperty({ type: [ChannelSelectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChannelSelectionDto)
  channels!: ChannelSelectionDto[];
}

export class DiscordChannelDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  parentId!: string | null;
}

export class DiscordConnectionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  guildId!: string;

  @ApiProperty()
  guildName!: string;

  @ApiProperty({ type: [DiscordChannelDto] })
  channels!: Array<{
    id: string;
    channelId: string;
    channelName: string;
    enabled: boolean;
    format: ChannelFormat;
    postGoals: boolean;
    postUpdates: boolean;
  }>;
}
