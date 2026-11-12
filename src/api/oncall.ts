import { chatClient, request } from './client';
import { CHAT } from './endpoints';
import type {
  DutySchedule,
  EscalateResponse,
  EscalationPolicy,
  OncallCurrentListResponse,
  OncallCurrentResponse,
  OncallEscalationResponse,
  OncallLayerTimelinesResponse,
  OncallScheduleResponse,
  OncallTimelineResponse,
  ScheduleDefinition,
  ScheduleHoliday,
  ScheduleOverride,
  ScheduleUnavailability,
} from './types';

/**
 * 原生值班排班 API。
 *
 * 所有写接口都要求管理员；页面用 `isAdmin` 隐藏入口，服务端仍是最终闸门。
 * 排班定义与 Override/不可用/节假日分开：保存定义只替换轮转，不会清掉运行期数据。
 */

const enc = encodeURIComponent;

export function getSchedule(group: string): Promise<OncallScheduleResponse> {
  return request<OncallScheduleResponse>(chatClient, {
    method: 'GET',
    url: CHAT.oncallSchedule(group),
  });
}

export function saveSchedule(
  group: string,
  definition: ScheduleDefinition
): Promise<OncallScheduleResponse> {
  return request<OncallScheduleResponse>(chatClient, {
    method: 'PUT',
    url: CHAT.oncallSchedule(group),
    data: definition,
  });
}

export function previewSchedule(
  group: string,
  definition: ScheduleDefinition,
  from: string,
  to: string
): Promise<OncallTimelineResponse> {
  return request<OncallTimelineResponse>(chatClient, {
    method: 'POST',
    url: CHAT.oncallSchedulePreview(group),
    data: { ...definition, from, to },
  });
}

export function getCurrent(group: string, at?: string): Promise<OncallCurrentResponse> {
  return request<OncallCurrentResponse>(chatClient, {
    method: 'GET',
    url: CHAT.oncallScheduleCurrent(group),
    params: at ? { at } : undefined,
  });
}

export function listCurrent(names?: string[]): Promise<OncallCurrentListResponse> {
  return request<OncallCurrentListResponse>(chatClient, {
    method: 'GET',
    url: CHAT.oncallCurrent,
    params: names?.length ? { names: names.join(',') } : undefined,
  });
}

export function getTimeline(
  group: string,
  from: string,
  to: string
): Promise<OncallTimelineResponse> {
  return request<OncallTimelineResponse>(chatClient, {
    method: 'GET',
    url: CHAT.oncallScheduleTimeline(group),
    params: { from, to },
  });
}

export function getLayerTimelines(
  group: string,
  from: string,
  to: string
): Promise<OncallLayerTimelinesResponse> {
  return request<OncallLayerTimelinesResponse>(chatClient, {
    method: 'GET',
    url: CHAT.oncallScheduleLayerTimelines(group),
    params: { from, to },
  });
}

export function listOverrides(group: string): Promise<{ overrides: ScheduleOverride[] }> {
  return request<{ overrides: ScheduleOverride[] }>(chatClient, {
    method: 'GET',
    url: CHAT.oncallOverrides(group),
  });
}

export function createOverride(
  group: string,
  input: { overrideUser: string; startTime: string; endTime: string }
): Promise<ScheduleOverride> {
  return request<ScheduleOverride>(chatClient, {
    method: 'POST',
    url: CHAT.oncallOverrides(group),
    data: input,
  });
}

export function deleteOverride(group: string, id: string): Promise<unknown> {
  return request<unknown>(chatClient, {
    method: 'DELETE',
    url: CHAT.oncallOverride(group, id),
  });
}

export function listUnavailabilities(
  group: string
): Promise<{ unavailabilities: ScheduleUnavailability[] }> {
  return request<{ unavailabilities: ScheduleUnavailability[] }>(chatClient, {
    method: 'GET',
    url: CHAT.oncallUnavailabilities(group),
  });
}

export function createUnavailability(
  group: string,
  input: {
    userName: string;
    startDate: string;
    endDate: string;
    reason?: string;
  }
): Promise<ScheduleUnavailability> {
  return request<ScheduleUnavailability>(chatClient, {
    method: 'POST',
    url: CHAT.oncallUnavailabilities(group),
    data: input,
  });
}

export function deleteUnavailability(group: string, id: string): Promise<unknown> {
  return request<unknown>(chatClient, {
    method: 'DELETE',
    url: CHAT.oncallUnavailability(group, id),
  });
}

export function listHolidays(group: string): Promise<{ holidays: ScheduleHoliday[] }> {
  return request<{ holidays: ScheduleHoliday[] }>(chatClient, {
    method: 'GET',
    url: CHAT.oncallHolidays(group),
  });
}

export function createHoliday(
  group: string,
  input: { date: string; name: string; countryCode?: string }
): Promise<ScheduleHoliday> {
  return request<ScheduleHoliday>(chatClient, {
    method: 'POST',
    url: CHAT.oncallHolidays(group),
    data: input,
  });
}

export function deleteHoliday(group: string, id: string): Promise<unknown> {
  return request<unknown>(chatClient, {
    method: 'DELETE',
    url: CHAT.oncallHoliday(group, id),
  });
}

export function getEscalation(group: string): Promise<OncallEscalationResponse> {
  return request<OncallEscalationResponse>(chatClient, {
    method: 'GET',
    url: CHAT.oncallEscalation(group),
  });
}

export function saveEscalation(
  group: string,
  policy: EscalationPolicy
): Promise<OncallEscalationResponse> {
  return request<OncallEscalationResponse>(chatClient, {
    method: 'PUT',
    url: CHAT.oncallEscalation(group),
    data: policy,
  });
}

export function escalateTicket(group: string, ticketId: string): Promise<EscalateResponse> {
  return request<EscalateResponse>(chatClient, {
    method: 'POST',
    url: CHAT.oncallEscalate(group),
    data: { ticketId },
  });
}

/** 把 saveSchedule 的返回值拆出定义，供表单使用。 */
export function definitionOf(schedule: DutySchedule | undefined): ScheduleDefinition {
  if (!schedule) {
    return { timezone: 'Asia/Shanghai', description: '', notificationChannel: '', layers: [] };
  }
  return {
    timezone: schedule.timezone,
    description: schedule.description,
    notificationChannel: schedule.notificationChannel,
    layers: schedule.layers,
  };
}

/** 编码查询参数里的组名列表。保留给未来的批量选择器使用。 */
export function groupListParam(names: string[]): string {
  return names.map(enc).join(',');
}
