import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Descriptions,
  Empty,
  Popconfirm,
  Result,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CodeOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ScheduleUserName } from '@/components/UserRef';
import { DetailShell, StatusSwitch, useIsMobile } from '@/ui';
import { useGoBack } from '@/runtime';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import { oncallGroupBinding } from '@/api/chat';
import {
  createHoliday,
  createOverride,
  createUnavailability,
  definitionOf,
  deleteHoliday,
  deleteOverride,
  deleteUnavailability,
  getCurrent,
  getEscalation,
  getLayerTimelines,
  getSchedule,
  getTimeline,
  listCurrent,
  listHolidays,
  listOverrides,
  listUnavailabilities,
  saveEscalation,
  saveSchedule,
} from '@/api/oncall';
import type {
  EscalationPolicy,
  EscalationTargetType,
  OncallCurrentResponse,
  OncallGroup,
  ScheduleDefinition,
  ScheduleHoliday,
  ScheduleLayer,
  ScheduleOverride,
  ScheduleUnavailability,
  TimelineSegment,
} from '@/api/types';
import GroupSummary from '@/components/oncall/GroupSummary';
import CurrentOnCallCard from '@/components/oncall/CurrentOnCallCard';
import OncallCalendar from '@/components/oncall/OncallCalendar';
import ShiftList from '@/components/oncall/ShiftList';
import LayerEditorDrawer from '@/components/oncall/LayerEditorDrawer';
import OverrideDrawer from '@/components/oncall/OverrideDrawer';
import AvailabilityDrawer from '@/components/oncall/AvailabilityDrawer';
import HolidayDrawer from '@/components/oncall/HolidayDrawer';
import EscalationPolicyEditor from '@/components/oncall/EscalationPolicyEditor';
import CommandDrawer from '@/components/oncall/CommandDrawer';
import {
  dayjs,
  defaultOverrideRange,
  formatInZone,
  rotationLabel,
  safeZone,
  startOfDay,
} from '@/components/oncall/time';

const LIST_PATH = '/oncall-groups';

/**
 * 值班组详情：概览、排班日历、轮转图层、Override、不可用与节假日、升级策略。
 *
 * 组元数据仍在 /v1/oncall-groups；排班与运行期数据走 /v1/oncall-groups/:name/...
 * 所有写操作只对管理员显示，服务端同样要求管理员。
 */
export default function OncallGroupDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const goBack = useGoBack(LIST_PATH);
  const queryClient = useQueryClient();
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const isAdmin = Boolean(claims?.isAdmin);
  const canRunDutyCommands = Boolean(claims?.isAdmin || claims?.isSRE);
  const isMobile = useIsMobile('lg');
  const [commandOpen, setCommandOpen] = useState(false);

  const segments = location.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[1] ?? '');

  const groupQuery = useQuery({
    queryKey: ['res', 'oncall-groups', 'item', id],
    queryFn: () => oncallGroupBinding.api.get(id),
    enabled: Boolean(id),
  });
  const scheduleQuery = useQuery({
    queryKey: ['oncall', 'schedule', id],
    queryFn: () => getSchedule(id),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
  const currentQuery = useQuery({
    queryKey: ['oncall', 'current', id],
    queryFn: () => getCurrent(id),
    enabled: Boolean(id),
    refetchInterval: 60_000,
  });
  const overridesQuery = useQuery({
    queryKey: ['oncall', 'overrides', id],
    queryFn: () => listOverrides(id),
    enabled: Boolean(id),
  });
  const unavailabilitiesQuery = useQuery({
    queryKey: ['oncall', 'unavailabilities', id],
    queryFn: () => listUnavailabilities(id),
    enabled: Boolean(id),
  });
  const holidaysQuery = useQuery({
    queryKey: ['oncall', 'holidays', id],
    queryFn: () => listHolidays(id),
    enabled: Boolean(id),
  });
  const escalationQuery = useQuery({
    queryKey: ['oncall', 'escalation', id],
    queryFn: () => getEscalation(id),
    enabled: Boolean(id),
  });
  const groupsQuery = useQuery({
    queryKey: ['res', 'oncall-groups', 'picker'],
    queryFn: () => oncallGroupBinding.api.list({ page: 1, pageSize: 500 }),
    staleTime: 60_000,
  });
  // 升级策略的“当前值班”预览。与值班组列表共用缓存，一次请求覆盖所有组。
  const currentsQuery = useQuery({
    queryKey: ['oncall', 'current', 'all'],
    queryFn: () => listCurrent(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const currentByGroup = useMemo(() => {
    const map = new Map<string, OncallCurrentResponse>();
    for (const item of currentsQuery.data?.items ?? []) {
      map.set(item.group, item);
    }
    return map;
  }, [currentsQuery.data]);

  const [monthStart, setMonthStart] = useState(() => dayjs().startOf('month'));
  const [view, setView] = useState<'month' | 'week'>('month');
  const [tzDraft, setTzDraft] = useState('UTC');
  useEffect(() => {
    setTzDraft(scheduleQuery.data?.schedule?.timezone || 'Asia/Shanghai');
  }, [scheduleQuery.data?.schedule?.timezone]);
  const windowDays = view === 'month' ? 31 : 7;
  const timezone = scheduleQuery.data?.schedule?.timezone
    ? safeZone(scheduleQuery.data.schedule.timezone)
    : 'Asia/Shanghai';
  const windowStartKey = monthStart.format('YYYY-MM-DD');
  const from = startOfDay(windowStartKey, timezone).toISOString();
  const to = startOfDay(windowStartKey, timezone).add(windowDays, 'day').toISOString();

  const timelinesQuery = useQuery({
    queryKey: ['oncall', 'layer-timelines', id, from, to],
    queryFn: () => getLayerTimelines(id, from, to),
    enabled: Boolean(id && scheduleQuery.data?.configured),
  });

  // 「轮转图层」每张卡片要显示“本层此刻谁值班”。日历时间线挂在当前浏览月份，
  // 翻月后就失效了，所以这里单独取一段从“现在”开始的时间线。
  const layerNowQuery = useQuery({
    queryKey: ['oncall', 'layer-timelines', 'now', id],
    queryFn: () => {
      const now = new Date();
      return getLayerTimelines(id, now.toISOString(), new Date(now.getTime() + 7 * 86400_000).toISOString());
    },
    enabled: Boolean(id && scheduleQuery.data?.configured),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // 概览里的「接下来的班次」独立于日历当前浏览的月份：无论日历翻到哪个月，
  // 这里都从「现在」开始算 14 天。否则用户翻到上个月后，概览会显示过去的值班人。
  const upcomingQuery = useQuery({
    queryKey: ['oncall', 'upcoming', id],
    queryFn: () => getTimeline(id, new Date().toISOString(), dayjs().add(14, 'day').toISOString()),
    enabled: Boolean(id && scheduleQuery.data?.configured),
    staleTime: 60_000,
  });

  const [layerEditor, setLayerEditor] = useState<{ open: boolean; index?: number; layer?: ScheduleLayer }>({
    open: false,
  });
  const [overrideEditor, setOverrideEditor] = useState<{ open: boolean; range?: [string, string] }>({
    open: false,
  });
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['oncall'] }),
      queryClient.invalidateQueries({ queryKey: ['res', 'oncall-groups'] }),
    ]);
  };

  const saveLayers = useMutation({
    mutationFn: async (input: { layers: ScheduleLayer[]; timezone?: string }) => {
      const definition: ScheduleDefinition = {
        ...definitionOf(scheduleQuery.data?.schedule),
        timezone: input.timezone || timezone,
        layers: input.layers.map((layer, index) => ({
          ...layer,
          orderIndex: index,
          participants: layer.participants.map((p, participantIndex) => ({
            userName: p.userName,
            orderIndex: participantIndex,
          })),
        })),
      };
      return saveSchedule(id, definition);
    },
    onSuccess: invalidateAll,
  });

  const createOverrideMutation = useMutation({
    mutationFn: (input: { overrideUser: string; startTime: string; endTime: string }) =>
      createOverride(id, input),
    onSuccess: invalidateAll,
  });
  const removeOverride = useMutation({
    mutationFn: (overrideId: string) => deleteOverride(id, overrideId),
    onSuccess: invalidateAll,
  });
  const createUnavailabilityMutation = useMutation({
    mutationFn: (input: { userName: string; startDate: string; endDate: string; reason?: string }) =>
      createUnavailability(id, input),
    onSuccess: invalidateAll,
  });
  const removeUnavailability = useMutation({
    mutationFn: (uid: string) => deleteUnavailability(id, uid),
    onSuccess: invalidateAll,
  });
  const createHolidayMutation = useMutation({
    mutationFn: (input: { date: string; name: string; countryCode?: string }) =>
      createHoliday(id, input),
    onSuccess: invalidateAll,
  });
  const removeHoliday = useMutation({
    mutationFn: (holidayId: string) => deleteHoliday(id, holidayId),
    onSuccess: invalidateAll,
  });
  const saveEscalationMutation = useMutation({
    mutationFn: (policy: EscalationPolicy) => saveEscalation(id, policy),
    onSuccess: invalidateAll,
  });
  const removeGroup = useMutation({
    mutationFn: () => {
      const remove = oncallGroupBinding.api.remove;
      return remove ? remove(id) : Promise.resolve();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['res', 'oncall-groups'] });
      navigate(LIST_PATH);
    },
  });

  if (!id) {
    return <Result status="404" title="缺少值班组名称" />;
  }
  if (groupQuery.isError) {
    return (
      <Result
        status="error"
        title="读取失败"
        subTitle={(groupQuery.error as Error | null)?.message ?? '这个值班组不存在。'}
        extra={<Button onClick={() => void groupQuery.refetch()}>重试</Button>}
      />
    );
  }

  const group = groupQuery.data as (OncallGroup & Record<string, unknown>) | undefined;
  const schedule = scheduleQuery.data;
  // 旧 Regen 排班：值班人能读，但成员、轮转、代班、升级策略都不在本地表里。
  // 页面上要说清楚「功能在，只是这组还没迁」，否则看起来像整块功能缺失。
  const legacyRegen = schedule?.configured === false && schedule?.source === 'regen';
  const layers = schedule?.schedule?.layers ?? [];
  const overrides = overridesQuery.data?.overrides ?? [];
  const unavailabilities = unavailabilitiesQuery.data?.unavailabilities ?? [];
  const holidays = holidaysQuery.data?.holidays ?? [];
  const allUsers = Array.from(
    new Set(layers.flatMap(layer => layer.participants.map(p => p.userName)))
  );
  const groupNames = (groupsQuery.data?.items ?? []).map(item => String(item.name));

  const rows = [
    { key: 'effective', label: '生效（含代班）', segments: timelinesQuery.data?.effective ?? [] },
    ...Object.entries(timelinesQuery.data?.layers ?? {}).map(([name, segments]) => ({
      key: `layer-${name}`,
      label: name,
      segments,
    })),
  ];

  const nowMs = Date.now();
  const upcoming = (upcomingQuery.data?.segments ?? [])
    .filter(segment => new Date(segment.end).getTime() > nowMs)
    .slice(0, 3);

  const actions = (
    <Space wrap>
      {isAdmin ? (
        <Button
          type="primary"
          onClick={() => navigate(`/oncall-groups/${encodeURIComponent(id)}/edit`)}
        >
          编辑
        </Button>
      ) : null}
      {canRunDutyCommands ? (
        <Button icon={<CodeOutlined />} onClick={() => setCommandOpen(true)}>
          命令
        </Button>
      ) : null}
      <Button onClick={() => void invalidateAll()}>刷新</Button>
      {isAdmin ? (
        <Popconfirm
          title="删除这个值班组？"
          description="组、排班、Override、不可用与升级策略会一起删除，无法恢复。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => removeGroup.mutate()}
        >
          <Button danger loading={removeGroup.isPending}>
            删除
          </Button>
        </Popconfirm>
      ) : null}
    </Space>
  );

  const tabs = [
    {
      key: 'overview',
      label: '概览',
      children: (
        <div>
          {!isAdmin ? <Alert type="info" showIcon message="当前账号不是管理员，页面只读。" style={{ marginBottom: 12 }} /> : null}
          {legacyRegen ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该组仍在使用旧 Regen 排班"
              description={
                `排班 ID：${schedule?.legacyScheduleId || '-'}。当前值班人可由 Regen 读取，` +
                '但成员、轮转、代班与升级策略不在本平台；创建原生轮转图层（或运行 regen-import）后由本平台接管。'
              }
            />
          ) : null}
          {group ? <GroupSummary group={group} schedule={schedule} /> : null}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
            <CurrentOnCallCard current={currentQuery.data} timezone={timezone} loading={currentQuery.isLoading} />
            <Card size="small" title="排班摘要">
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="排班来源">
                  {schedule?.configured ? '原生排班' : schedule?.source === 'regen' ? '旧 Regen 排班' : '未配置'}
                </Descriptions.Item>
                <Descriptions.Item label="时区">{timezone}</Descriptions.Item>
                <Descriptions.Item label="图层">{layers.length ? layers.map(l => l.name).join('、') : '-'}</Descriptions.Item>
                <Descriptions.Item label="参与者">
                  {allUsers.length ? (
                    <Space wrap size={4}>
                      {allUsers.map(name => (
                        <ScheduleUserName key={name} value={name} />
                      ))}
                    </Space>
                  ) : (
                    '-'
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="未来 Override">{overrides.length}</Descriptions.Item>
                <Descriptions.Item label="升级层级">{escalationQuery.data?.policy?.tiers?.length ?? 0}</Descriptions.Item>
              </Descriptions>
            </Card>
          </div>
          <Card size="small" title="接下来的班次" style={{ marginTop: 16 }}>
            {upcoming.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  schedule?.configured ? '未来 14 天没有排班' : '还没有原生排班，先创建轮转图层'
                }
              />
            ) : (
              <Table
                size="small"
                rowKey={segment => `${segment.start}-${segment.userName}`}
                pagination={false}
                dataSource={upcoming}
                columns={[
                  {
                    title: '值班人',
                    dataIndex: 'userName',
                    render: (value: string, segment) => (
                      <Space size={6}>
                        <ScheduleUserName value={value} />
                        {new Date(segment.start).getTime() <= nowMs &&
                        nowMs < new Date(segment.end).getTime() ? (
                          <Tag bordered={false} color="green">
                            当前
                          </Tag>
                        ) : null}
                        {segment.isOverride ? (
                          <Tag bordered={false} color="purple">
                            代班
                          </Tag>
                        ) : null}
                      </Space>
                    ),
                  },
                  {
                    title: '开始',
                    dataIndex: 'start',
                    render: (value: string) => formatInZone(value, timezone, 'MM-DD HH:mm'),
                  },
                  {
                    title: '结束',
                    dataIndex: 'end',
                    render: (value: string) => formatInZone(value, timezone, 'MM-DD HH:mm'),
                  },
                ]}
              />
            )}
          </Card>
          <Card size="small" title="即将到来的 Override" style={{ marginTop: 16 }}>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={overrides.slice(0, 5)}
              columns={[
                {
                  title: '代班人',
                  dataIndex: 'overrideUser',
                  render: (value: string) => <ScheduleUserName value={value} />,
                },
                {
                  title: '开始',
                  dataIndex: 'startTime',
                  render: (value: string) => formatInZone(value, timezone, 'MM-DD HH:mm'),
                },
                {
                  title: '结束',
                  dataIndex: 'endTime',
                  render: (value: string) => formatInZone(value, timezone, 'MM-DD HH:mm'),
                },
              ]}
            />
          </Card>
        </div>
      ),
    },
    {
      key: 'calendar',
      label: '排班日历',
      children: (
        <div>
          {!schedule?.configured ? (
            <Empty
              description={
                legacyRegen
                  ? `该组仍使用旧 Regen 排班（${schedule?.legacyScheduleId || '-'}），值班人由 Regen 求值，平台内没有可展示的轮转图层。创建一个原生图层后由本平台接管。`
                  : '还没有原生排班。先在「轮转图层」创建第一个图层，或运行 regen-import 导入旧排班。'
              }
            >
              {isAdmin ? (
                <Button type="primary" onClick={() => setLayerEditor({ open: true })}>
                  创建原生排班
                </Button>
              ) : null}
            </Empty>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <Segmented
                  value={view}
                  onChange={value => setView(value as 'month' | 'week')}
                  options={[
                    { value: 'month', label: '月视图' },
                    { value: 'week', label: '周视图' },
                  ]}
                />
              </div>
              {isMobile ? (
                <ShiftList segments={timelinesQuery.data?.effective ?? []} timezone={timezone} />
              ) : (
                <OncallCalendar
                  timezone={timezone}
                  windowStart={monthStart.format('YYYY-MM-DD')}
                  stepUnit={view === 'month' ? 'month' : 'day'}
                  days={view === 'month' ? monthStart.daysInMonth() : 7}
                  rows={rows}
                  holidays={holidays}
                  onNavigate={(delta, unit) => {
                    if (unit === 'month') setMonthStart(prev => prev.add(delta, 'month').startOf('month'));
                    else setMonthStart(prev => prev.add(delta, 'day'));
                  }}
                  onToday={() => setMonthStart(dayjs().startOf('month'))}
                  onDayClick={
                    isAdmin
                      ? dayKey => {
                          setOverrideEditor({
                            open: true,
                            range: defaultOverrideRange(dayKey, timezone),
                          });
                        }
                      : undefined
                  }
                />
              )}
            </>
          )}
        </div>
      ),
    },
    {
      key: 'layers',
      label: '轮转图层',
      children: (
        <div>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="轮转图层如何工作"
            description={
              <Space direction="vertical" size={2}>
                <Typography.Text>
                  回退链：第 1 层是主值班层，此刻有人可用就由它值班；整层都无人可用才由下一层接手。
                </Typography.Text>
                <Typography.Text>
                  层内轮转：班次序号 = floor((当前时间 − 轮转起点) ÷ 班次时长)，值班人 = 参与者[班次序号 mod
                  人数]。
                </Typography.Text>
                <Typography.Text>
                  不可用顺延：某人被标记不可用时，在同一层内顺延到下一位；整层都不可用才落到下一层。
                </Typography.Text>
                <Typography.Text>
                  代班优先：Override 覆盖所有图层，命中时直接由代班人值班。
                </Typography.Text>
                <Typography.Text>
                  时区：班次边界按绝对时长推进；时区只决定不可用与节假日的自然日。
                </Typography.Text>
                <Typography.Text type="secondary">
                  下方「此刻值班」按各图层自身时间线计算，不含 Override；含代班的最终结果见「概览」。
                </Typography.Text>
              </Space>
            }
          />
          <Card size="small" title="排班设置" style={{ marginBottom: 16 }}>
            <Space wrap>
              <Typography.Text>时区</Typography.Text>
              <AutoComplete
                value={tzDraft}
                onChange={setTzDraft}
                style={{ width: 260 }}
                options={[
                  'Asia/Shanghai',
                  'Asia/Hong_Kong',
                  'Asia/Singapore',
                  'Asia/Tokyo',
                  'UTC',
                  'Europe/London',
                  'America/Los_Angeles',
                  'America/New_York',
                ].map(zone => ({ value: zone }))}
                placeholder="IANA 时区，例如 Asia/Shanghai"
              />
              {isAdmin ? (
                <Button
                  onClick={() => void saveLayers.mutateAsync({ layers, timezone: tzDraft })}
                  loading={saveLayers.isPending}
                >
                  保存时区
                </Button>
              ) : null}
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              时区决定日历分桶、不可用与节假日的自然日；班次边界仍从轮转起点按绝对时长推进。
            </Typography.Paragraph>
          </Card>
          {layers.length === 0 ? (
            <Empty
              description={
                legacyRegen
                  ? '该组仍使用旧 Regen 排班，成员与轮转在 Regen 侧；新增图层后由本平台接管。'
                  : '还没有图层'
              }
            />
          ) : null}
          {layers.map((layer, index) => (
            <Card
              key={`${layer.name}-${index}`}
              size="small"
              title={
                <Space>
                  <span>{layer.name}</span>
                  <Tag>{rotationLabel(layer.rotationType, layer.shiftDurationSeconds)}</Tag>
                </Space>
              }
              style={{ marginBottom: 12 }}
              extra={
                isAdmin ? (
                  <Space>
                    <Button size="small" onClick={() => setLayerEditor({ open: true, index, layer })}>
                      编辑
                    </Button>
                    <Popconfirm
                      title="删除这个图层？"
                      onConfirm={() =>
                        void saveLayers.mutateAsync({ layers: layers.filter((_, i) => i !== index) })
                      }
                    >
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ) : null
              }
            >
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="轮转起点">
                  {formatInZone(layer.rotationStart, timezone, 'YYYY-MM-DD HH:mm')}
                </Descriptions.Item>
                <Descriptions.Item label="此刻值班">
                  <LayerCurrentOncall
                    segments={layerNowQuery.data?.layers[layer.name]}
                    at={nowMs}
                    endAt={shiftEndOf(layer, nowMs)}
                    timezone={timezone}
                    isLast={index === layers.length - 1}
                    loading={layerNowQuery.isLoading}
                    failed={layerNowQuery.isError}
                  />
                </Descriptions.Item>
                <Descriptions.Item label="参与者">
                  <Space wrap>
                    {layer.participants.map((participant, participantIndex) => (
                      <Tag key={`${participant.userName}-${participantIndex}`} color="blue">
                        {participantIndex + 1}. <ScheduleUserName value={participant.userName} />
                      </Tag>
                    ))}
                  </Space>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          ))}
          {isAdmin ? (
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => setLayerEditor({ open: true })}>
              新增图层
            </Button>
          ) : null}
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
            保存图层会立即刷新 /duty 与派单。
          </Typography.Paragraph>
        </div>
      ),
    },
    {
      key: 'overrides',
      label: 'Override',
      children: (
        <div>
          {isAdmin ? (
            <Button
              type="primary"
              style={{ marginBottom: 12 }}
              onClick={() => setOverrideEditor({ open: true })}
            >
              新建
            </Button>
          ) : null}
          <OverrideTable
            rows={overrides}
            timezone={timezone}
            canDelete={isAdmin}
            onDelete={overrideId => removeOverride.mutate(overrideId)}
          />
        </div>
      ),
    },
    {
      key: 'availability',
      label: '不可用与节假日',
      children: (
        <div>
          <Card
            size="small"
            title="不可用"
            style={{ marginBottom: 16 }}
            extra={
              isAdmin ? (
                <Button size="small" icon={<PlusOutlined />} onClick={() => setAvailabilityOpen(true)}>
                  标记不可用
                </Button>
              ) : null
            }
          >
            <UnavailabilityTable
              rows={unavailabilities}
              canDelete={isAdmin}
              onDelete={uid => removeUnavailability.mutate(uid)}
            />
          </Card>
          <Card
            size="small"
            title="节假日（手工维护，仅日历提示）"
            extra={
              isAdmin ? (
                <Button size="small" icon={<PlusOutlined />} onClick={() => setHolidayOpen(true)}>
                  添加节假日
                </Button>
              ) : null
            }
          >
            <HolidayTable rows={holidays} canDelete={isAdmin} onDelete={hid => removeHoliday.mutate(hid)} />
          </Card>
        </div>
      ),
    },
    {
      key: 'escalation',
      label: '升级策略',
      children: schedule?.configured ? (
        isAdmin ? (
          <EscalationPolicyEditor
            policy={escalationQuery.data?.policy}
            groups={groupNames}
            group={id}
            currentByGroup={currentByGroup}
            saving={saveEscalationMutation.isPending}
            onSave={async policy => {
              await saveEscalationMutation.mutateAsync(policy);
            }}
          />
        ) : (
          <ReadOnlyEscalation policy={escalationQuery.data?.policy} />
        )
      ) : (
        <Empty
          description={
            legacyRegen
              ? '该组仍使用旧 Regen 排班，升级策略由 Regen 管理。创建原生排班后，可在此配置层级与超时。'
              : '先创建原生排班，才能配置升级策略。'
          }
        />
      ),
    },
  ];

  return (
    <>
      <DetailShell
        id={group?.displayName || id}
        showId
        onBack={goBack}
        loading={groupQuery.isLoading}
        actions={actions}
        tabs={tabs}
      />
      <LayerEditorDrawer
        open={layerEditor.open}
        layer={layerEditor.layer}
        preferValues={allUsers}
        onCancel={() => setLayerEditor({ open: false })}
        onSubmit={async layer => {
          const next = [...layers];
          if (layerEditor.index === undefined) next.push(layer);
          else next[layerEditor.index] = layer;
          await saveLayers.mutateAsync({ layers: next });
          setLayerEditor({ open: false });
        }}
      />
      <OverrideDrawer
        open={overrideEditor.open}
        initialRange={overrideEditor.range}
        onCancel={() => setOverrideEditor({ open: false })}
        onSubmit={async input => {
          await createOverrideMutation.mutateAsync(input);
          setOverrideEditor({ open: false });
        }}
      />
      <AvailabilityDrawer
        open={availabilityOpen}
        users={allUsers}
        onCancel={() => setAvailabilityOpen(false)}
        onSubmit={async input => {
          await createUnavailabilityMutation.mutateAsync(input);
          setAvailabilityOpen(false);
        }}
      />
      <HolidayDrawer
        open={holidayOpen}
        onCancel={() => setHolidayOpen(false)}
        onSubmit={async input => {
          await createHolidayMutation.mutateAsync(input);
          setHolidayOpen(false);
        }}
      />
      <CommandDrawer
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        group={id}
        timezone={schedule?.schedule?.timezone}
        isAdmin={isAdmin}
      />
    </>
  );
}

function OverrideTable({
  rows,
  timezone,
  canDelete,
  onDelete,
}: {
  rows: ScheduleOverride[];
  timezone: string;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <Table
      size="small"
      rowKey="id"
      dataSource={rows}
      pagination={false}
      scroll={{ x: 'max-content' }}
      columns={[
        {
          title: '代班人',
          dataIndex: 'overrideUser',
          render: (value: string) => <ScheduleUserName value={value} />,
        },
        {
          title: '开始',
          dataIndex: 'startTime',
          render: (value: string) => formatInZone(value, timezone, 'YYYY-MM-DD HH:mm'),
        },
        {
          title: '结束',
          dataIndex: 'endTime',
          render: (value: string) => formatInZone(value, timezone, 'YYYY-MM-DD HH:mm'),
        },
        { title: '创建人', dataIndex: 'createdBy', render: (value?: string) => value || '-' },
        ...(canDelete
          ? [
              {
                title: '操作',
                key: 'actions',
                render: (_: unknown, row: ScheduleOverride) => (
                  <Popconfirm title="删除这个 Override？" onConfirm={() => onDelete(row.id)}>
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

function UnavailabilityTable({
  rows,
  canDelete,
  onDelete,
}: {
  rows: ScheduleUnavailability[];
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <Table
      size="small"
      rowKey="id"
      dataSource={rows}
      pagination={false}
      scroll={{ x: 'max-content' }}
      columns={[
        {
          title: '值班人',
          dataIndex: 'userName',
          render: (value: string) => <ScheduleUserName value={value} />,
        },
        { title: '开始日期', dataIndex: 'startDate' },
        { title: '结束日期', dataIndex: 'endDate' },
        { title: '原因', dataIndex: 'reason', render: (value?: string) => value || '-' },
        ...(canDelete
          ? [
              {
                title: '操作',
                key: 'actions',
                render: (_: unknown, row: ScheduleUnavailability) => (
                  <Popconfirm title="删除这条不可用记录？" onConfirm={() => onDelete(row.id)}>
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

function HolidayTable({
  rows,
  canDelete,
  onDelete,
}: {
  rows: ScheduleHoliday[];
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <Table
      size="small"
      rowKey="id"
      dataSource={rows}
      pagination={false}
      scroll={{ x: 'max-content' }}
      columns={[
        { title: '日期', dataIndex: 'date' },
        { title: '名称', dataIndex: 'name' },
        { title: '国家/地区', dataIndex: 'countryCode', render: (value?: string) => value || '-' },
        ...(canDelete
          ? [
              {
                title: '操作',
                key: 'actions',
                render: (_: unknown, row: ScheduleHoliday) => (
                  <Popconfirm title="删除这个节假日标记？" onConfirm={() => onDelete(row.id)}>
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

const ESCALATION_TARGET_LABEL: Record<EscalationTargetType, string> = {
  schedule: '当前排班的值班人',
  users: '指定人员',
  both: '两者',
};

function ReadOnlyEscalation({ policy }: { policy?: EscalationPolicy }) {
  if (!policy) return <Empty description="未配置升级策略" />;
  return (
    <Card
      size="small"
      title={
        <Space>
          <span>升级策略</span>
          <StatusSwitch
            checked={policy.enabled}
            onLabel="已启用"
            offLabel="未启用"
            disabled
          />
        </Space>
      }
    >
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="自动启动">{policy.autoEscalate ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="最高级别">
          {policy.autoEscalateFromLevel === 0 ? '不限制' : `P${policy.autoEscalateFromLevel}`}
        </Descriptions.Item>
        <Descriptions.Item label="层级">
          {policy.tiers.length === 0 ? (
            '-'
          ) : (
            <Space direction="vertical" size={4}>
              {policy.tiers.map(tier => (
                <Space key={tier.index} wrap size={6}>
                  <Tag>第 {tier.index + 1} 级</Tag>
                  <span>{tier.timeoutSeconds}s</span>
                  <span>{ESCALATION_TARGET_LABEL[tier.targetType]}</span>
                  {tier.targetType === 'users' ? null : (
                    <span>· 指定组：{tier.groupName || '本组'}</span>
                  )}
                  {tier.targetType !== 'schedule' && tier.userNames?.length ? (
                    <span>
                      · 指定人员：
                      {tier.userNames.map((name, nameIndex) => (
                        <span key={`${tier.index}-${name}`}>
                          {nameIndex > 0 ? '、' : ''}
                          <ScheduleUserName value={name} />
                        </span>
                      ))}
                    </span>
                  ) : null}
                </Space>
              ))}
            </Space>
          )}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

/** 半开区间 [start, end) 上的那一段，避免交接瞬间同时命中两段。 */
function segmentCovering(
  segments: TimelineSegment[] | undefined,
  at: number
): TimelineSegment | undefined {
  return segments?.find(segment => {
    const start = Date.parse(segment.start);
    const end = Date.parse(segment.end);
    return start <= at && at < end;
  });
}

/**
 * 本班次的结束时刻。不能直接用时间线 segment 的 end：查询窗口是
 * 「现在 + N 天」，当代班时长超过窗口时 segment 会被窗口截断。
 * 班次边界与后端一致：起点 + (slot+1) × 班次时长。
 */
function shiftEndOf(layer: ScheduleLayer, at: number): number | undefined {
  const duration = layer.shiftDurationSeconds * 1000;
  const start = Date.parse(layer.rotationStart);
  if (!Number.isFinite(start) || duration <= 0 || at < start) return undefined;
  const slot = Math.floor((at - start) / duration);
  return start + (slot + 1) * duration;
}

function LayerCurrentOncall({
  segments,
  at,
  endAt,
  timezone,
  isLast,
  loading,
  failed,
}: {
  segments?: TimelineSegment[];
  at: number;
  endAt?: number;
  timezone: string;
  isLast: boolean;
  loading?: boolean;
  failed?: boolean;
}) {
  if (failed) return <Typography.Text type="secondary">-</Typography.Text>;
  if (loading) return <Typography.Text type="secondary">加载中…</Typography.Text>;

  const segment = segmentCovering(segments, at);
  if (!segment) {
    return (
      <Typography.Text type="secondary">
        {endAt
          ? isLast
            ? '该层此刻无人可用'
            : '该层此刻无人可用，已回退到下一层'
          : '轮转尚未开始'}
      </Typography.Text>
    );
  }
  return (
    <Space size={6} wrap>
      <ScheduleUserName value={segment.userName} />
      {endAt ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          至 {formatInZone(new Date(endAt).toISOString(), timezone, 'MM-DD HH:mm')}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
