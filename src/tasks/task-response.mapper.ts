import {
  instantToIsoUtcNullable,
  utcTaskDayToIsoResponse,
} from "../common/utc-datetime";
import { TaskResponseDto } from "./dto/task.dto";

type TaskRow = {
  id: string;
  title: string;
  date: Date;
  doneAt: Date | null;
  position: number;
};

export function toTaskResponseDto(t: TaskRow): TaskResponseDto {
  return {
    id: t.id,
    title: t.title,
    date: utcTaskDayToIsoResponse(t.date),
    doneAt: instantToIsoUtcNullable(t.doneAt),
    position: t.position,
  };
}
